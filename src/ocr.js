const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { ocrSpace } = require('ocr-space-api-wrapper');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Khởi tạo Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Tạo các thư mục cần thiết
const TEMP_DIR = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TEMP_DIR);

// OCR Space API Key
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || 'K81626103188957'; // Sử dụng API key dự phòng nếu không có trong .env

// Tải ảnh từ URL về thư mục tạm
async function downloadImageForOCR(imageUrl) {
  try {
    console.log(`  Downloading image: ${imageUrl}`);
    console.log(`  Đang tải ảnh: ${imageUrl}`);
    
    // Tạo tên file duy nhất
    const tempFilePath = path.join(TEMP_DIR, `temp_${Date.now()}.jpg`);
    
    // Mã hóa URL an toàn
    const safeUrl = encodeURI(imageUrl);
    
    // Tải ảnh bằng axios
    const response = await axios({
      method: 'GET',
      url: safeUrl,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 15000 // 15 giây timeout
    });
    
    // Lưu ảnh vào file
    await fs.writeFile(tempFilePath, response.data);
    console.log(`  Image downloaded and saved to: ${tempFilePath}`);
    console.log(`  Ảnh đã được tải và lưu vào: ${tempFilePath}`);
    
    return tempFilePath;
  } catch (error) {
    console.error(`Error downloading image: ${error.message}`);
    console.error(`Lỗi tải ảnh: ${error.message}`);
    throw error;
  }
}

// Thực hiện OCR trên ảnh sử dụng OCR.space API
async function performOCR(imagePath) {
  try {
    console.log(`  Performing OCR on: ${imagePath}`);
    console.log(`  Đang thực hiện OCR trên: ${imagePath}`);
    
    const options = {
      apiKey: OCR_SPACE_API_KEY,
      isTable: false,
      OCREngine: 2, // Sử dụng OCR Engine 2 cho độ chính xác cao
      language: 'auto', // Tự động phát hiện ngôn ngữ
      isCreateSearchablePdf: false,
      isSearchablePdfHideTextLayer: false,
      scale: true,
      isOverlayRequired: true,
      detectOrientation: true
    };
    
    // Gọi OCR.space API
    const result = await ocrSpace(imagePath, options);
    
    console.log(`  OCR completed with status: ${result.IsErroredOnProcessing ? 'Error' : 'Success'}`);
    console.log(`  OCR hoàn thành với trạng thái: ${result.IsErroredOnProcessing ? 'Lỗi' : 'Thành công'}`);
    
    if (result.IsErroredOnProcessing) {
      throw new Error(`OCR Error: ${result.ErrorMessage || 'Unknown error'}`);
    }
    
    // Lấy kết quả văn bản và thông tin overlay
    const textResults = result.ParsedResults && result.ParsedResults.length > 0 
      ? result.ParsedResults[0] 
      : { ParsedText: '', TextOverlay: { Lines: [] } };
    
    console.log(`  OCR text result (first 100 chars): ${textResults.ParsedText.substring(0, 100)}${textResults.ParsedText.length > 100 ? '...' : ''}`);
    console.log(`  OCR kết quả văn bản (100 ký tự đầu): ${textResults.ParsedText.substring(0, 100)}${textResults.ParsedText.length > 100 ? '...' : ''}`);
    
    return {
      text: textResults.ParsedText,
      lines: textResults.TextOverlay.Lines || [],
      exitCode: result.OCRExitCode,
      isErrored: result.IsErroredOnProcessing,
      processingTimeInMs: result.ProcessingTimeInMilliseconds
    };
  } catch (error) {
    console.error(`OCR error: ${error.message}`);
    console.error(`Lỗi OCR: ${error.message}`);
    return { text: '', lines: [], exitCode: -1, isErrored: true };
  }
}

// Sử dụng Gemini API để phân tích kết quả OCR và xác định tên thuốc
async function analyzeDrugNameWithGemini(ocrText, imageUrl) {
  try {
    console.log(`  Analyzing OCR results with Gemini AI...`);
    console.log(`  Đang phân tích kết quả OCR với Gemini AI...`);
    
    if (!ocrText || ocrText.trim() === '') {
      console.log(`  No OCR text to analyze`);
      console.log(`  Không có văn bản OCR để phân tích`);
      return { drugName: null, confidence: 0 };
    }
    
    // Tạo prompt cho Gemini
    const prompt = `
    Dựa vào văn bản được trích xuất từ ảnh sản phẩm dược phẩm dưới đây, hãy xác định tên của loại thuốc.
    Nếu có thể, hãy cung cấp:
    1. Tên thuốc/sản phẩm dược phẩm (bắt buộc)
    2. Thành phần hoạt chất chính và liều lượng (nếu có)
    3. Mức độ tin cậy về việc xác định đúng tên thuốc (0-100%)
    
    Đây là văn bản OCR từ ảnh: 
    "${ocrText}"
    
    Trả về kết quả dưới định dạng JSON có cấu trúc như sau:
    {
      "drugName": "Tên thuốc/sản phẩm",
      "activeIngredient": "Thành phần hoạt chất chính",
      "dosage": "Liều lượng",
      "confidence": <0-100>
    }
    
    Hãy chỉ trả về JSON, không có văn bản phụ trước hoặc sau.
    `;
    
    // Gọi Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    // Trích xuất JSON từ phản hồi
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : '{}';
    
    try {
      const jsonData = JSON.parse(jsonText);
      console.log(`  Gemini identified drug: ${jsonData.drugName || 'Unknown'} (confidence: ${jsonData.confidence || 0}%)`);
      console.log(`  Gemini xác định thuốc: ${jsonData.drugName || 'Không xác định'} (độ tin cậy: ${jsonData.confidence || 0}%)`);
      return jsonData;
    } catch (jsonError) {
      console.error(`  Error parsing Gemini response as JSON: ${jsonError.message}`);
      console.error(`  Lỗi phân tích phản hồi Gemini dưới dạng JSON: ${jsonError.message}`);
      console.log(`  Raw response: ${text}`);
      return { drugName: null, confidence: 0 };
    }
  } catch (error) {
    console.error(`Gemini API error: ${error.message}`);
    console.error(`Lỗi Gemini API: ${error.message}`);
    return { drugName: null, confidence: 0 };
  }
}

// Xác định vị trí sản phẩm dựa trên dữ liệu OCR và tên thuốc
function determineProductLocation(ocrResult, drugName) {
  try {
    console.log(`  Determining product location for: ${drugName || 'Unknown drug'}`);
    console.log(`  Xác định vị trí sản phẩm cho: ${drugName || 'Thuốc không xác định'}`);
    
    // Nếu không có dữ liệu OCR hoặc không có dòng văn bản
    if (!ocrResult.lines || ocrResult.lines.length === 0) {
      console.log(`  No OCR lines data available, using default position`);
      console.log(`  Không có dữ liệu dòng OCR, sử dụng vị trí mặc định`);
      return {
        x_center: 0.5,
        y_center: 0.5,
        width: 0.8,
        height: 0.8
      };
    }
    
    // Nếu không có tên thuốc, sử dụng toàn bộ văn bản để xác định vị trí
    if (!drugName) {
      // Tính toán bounding box từ tất cả các dòng văn bản
      return calculateBoxFromAllLines(ocrResult.lines);
    }
    
    // Nếu có tên thuốc, tìm các dòng có chứa tên thuốc
    const drugNameParts = drugName.toLowerCase().split(/\s+/);
    const matchingLines = findMatchingLines(ocrResult.lines, drugNameParts);
    
    if (matchingLines.length > 0) {
      console.log(`  Found ${matchingLines.length} lines matching drug name`);
      console.log(`  Tìm thấy ${matchingLines.length} dòng khớp với tên thuốc`);
      return calculateBoxFromLines(matchingLines);
    } else {
      console.log(`  No matching lines found, using all text location`);
      console.log(`  Không tìm thấy dòng khớp, sử dụng vị trí từ tất cả văn bản`);
      return calculateBoxFromAllLines(ocrResult.lines);
    }
  } catch (error) {
    console.error(`Error determining product location: ${error.message}`);
    console.error(`Lỗi xác định vị trí sản phẩm: ${error.message}`);
    return {
      x_center: 0.5,
      y_center: 0.5,
      width: 0.8,
      height: 0.8
    };
  }
}

// Tìm các dòng văn bản có chứa tên thuốc
function findMatchingLines(lines, drugNameParts) {
  const matchingLines = [];
  
  for (const line of lines) {
    if (!line.Words || line.Words.length === 0) continue;
    
    // Nối các từ trong dòng thành một chuỗi và chuyển thành chữ thường
    const lineText = line.Words.map(word => word.WordText).join(' ').toLowerCase();
    
    // Kiểm tra xem dòng có chứa bất kỳ phần nào của tên thuốc không
    const matches = drugNameParts.some(part => {
      // Bỏ qua các từ quá ngắn (dưới 3 ký tự)
      if (part.length < 3) return false;
      
      // Tìm kiếm phần tên thuốc trong văn bản dòng
      return lineText.includes(part);
    });
    
    if (matches) {
      matchingLines.push(line);
    }
  }
  
  return matchingLines;
}

// Tính toán bounding box từ các dòng khớp với tên thuốc
function calculateBoxFromLines(lines) {
  // Tính toán giới hạn từ tất cả các từ
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = 0;
  let maxBottom = 0;
  let maxLineHeight = 0;
  
  // Đối với OCR.space, tọa độ là giá trị tuyệt đối pixel
  for (const line of lines) {
    for (const word of line.Words) {
      minLeft = Math.min(minLeft, word.Left);
      minTop = Math.min(minTop, word.Top);
      maxRight = Math.max(maxRight, word.Left + word.Width);
      maxBottom = Math.max(maxBottom, word.Top + word.Height);
      maxLineHeight = Math.max(maxLineHeight, word.Height);
    }
  }
  
  // Mở rộng box để bao phủ toàn bộ sản phẩm (không chỉ văn bản)
  const additionalWidthPadding = (maxRight - minLeft) * 0.2; // 20% thêm vào mỗi bên
  const topPadding = maxLineHeight * 1.5; // Thêm một khoảng phía trên văn bản
  const bottomPadding = (maxBottom - minTop) * 2.0; // Thêm nhiều hơn ở phía dưới để bao phủ phần còn lại của sản phẩm
  
  // Tính toán kích thước mới với padding
  const paddedLeft = Math.max(0, minLeft - additionalWidthPadding);
  const paddedTop = Math.max(0, minTop - topPadding);
  const paddedRight = maxRight + additionalWidthPadding;
  const paddedBottom = maxBottom + bottomPadding;
  
  // Giả định kích thước ảnh là 1000x1000 (sẽ được chuẩn hóa thành tỷ lệ [0,1])
  const imageWidth = 1000;
  const imageHeight = 1000;
  
  // Chuẩn hóa tọa độ về khoảng [0,1]
  const left = paddedLeft / imageWidth;
  const top = paddedTop / imageHeight;
  const right = paddedRight / imageWidth;
  const bottom = paddedBottom / imageHeight;
  
  // Tính toán các giá trị YOLO (trung tâm, chiều rộng, chiều cao)
  const width = right - left;
  const height = bottom - top;
  const x_center = left + width / 2;
  const y_center = top + height / 2;
  
  // Đảm bảo các giá trị không vượt ra khỏi khoảng [0,1]
  return {
    x_center: Math.min(1, Math.max(0, x_center)),
    y_center: Math.min(1, Math.max(0, y_center)),
    width: Math.min(1, Math.max(0.1, width)),
    height: Math.min(1, Math.max(0.1, height))
  };
}

// Tính toán bounding box từ tất cả các dòng văn bản
function calculateBoxFromAllLines(lines) {
  // Nếu không có dòng nào, trả về vị trí mặc định
  if (lines.length === 0) {
    return {
      x_center: 0.5,
      y_center: 0.5,
      width: 0.8,
      height: 0.8
    };
  }
  
  // Sắp xếp các dòng theo thứ tự từ trên xuống dưới
  lines.sort((a, b) => {
    // Lấy giá trị Top của dòng (sử dụng từ đầu tiên)
    const aTop = a.Words && a.Words.length > 0 ? a.Words[0].Top : 0;
    const bTop = b.Words && b.Words.length > 0 ? b.Words[0].Top : 0;
    return aTop - bTop;
  });
  
  // Ưu tiên các dòng đầu tiên (thường là tên sản phẩm)
  // Lấy tối đa 3 dòng đầu tiên hoặc một phần ba số dòng, tùy theo giá trị nào lớn hơn
  const numLinesToUse = Math.max(3, Math.floor(lines.length / 3));
  const prioritizedLines = lines.slice(0, numLinesToUse);
  
  // Sử dụng cùng logic như hàm calculateBoxFromLines
  return calculateBoxFromLines(prioritizedLines);
}

// Hàm chính để xác định vị trí sản phẩm trong nhiều ảnh
async function generateProductLocationWithOCR(imageUrls, productName = '') {
  if (!Array.isArray(imageUrls)) {
    imageUrls = [imageUrls]; // Đảm bảo imageUrls là một mảng
  }
  
  console.log(`Analyzing product location with OCR.space for ${imageUrls.length} images`);
  console.log(`Phân tích vị trí sản phẩm bằng OCR.space cho ${imageUrls.length} ảnh`);
  
  const results = [];
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    console.log(`\nProcessing image ${i+1}/${imageUrls.length}: ${imageUrl}`);
    console.log(`Đang xử lý ảnh ${i+1}/${imageUrls.length}: ${imageUrl}`);
    
    try {
      // Tải ảnh về
      const tempFilePath = await downloadImageForOCR(imageUrl);
      
      // Thực hiện OCR
      const ocrResult = await performOCR(tempFilePath);
      
      // Phân tích kết quả OCR với Gemini để xác định tên thuốc
      const drugInfo = await analyzeDrugNameWithGemini(ocrResult.text, imageUrl);
      
      // Xác định vị trí dựa trên kết quả OCR và tên thuốc
      const location = determineProductLocation(ocrResult, drugInfo.drugName);
      
      // Thêm kết quả vào mảng
      results.push({
        imageIndex: i,
        location: location,
        drugInfo: drugInfo,
        success: true,
        url: imageUrl
      });
      
      // Dọn dẹp file tạm
      await fs.remove(tempFilePath).catch(() => {});
      
      // Thêm độ trễ giữa các yêu cầu OCR.space (giới hạn API free)
      if (i < imageUrls.length - 1) {
        console.log(`Waiting 5 seconds before processing next image...`);
        console.log(`Chờ 5 giây trước khi xử lý ảnh tiếp theo...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 giây độ trễ
      }
    } catch (error) {
      console.error(`Error processing image ${i} with OCR: ${error.message}`);
      console.error(`Lỗi xử lý ảnh ${i} với OCR: ${error.message}`);
      
      // Thêm kết quả mặc định nếu có lỗi
      results.push({
        imageIndex: i,
        location: {
          x_center: 0.5,
          y_center: 0.5,
          width: 0.8,
          height: 0.8
        },
        drugInfo: { drugName: null, confidence: 0 },
        success: false,
        error: error.message,
        url: imageUrl
      });
    }
  }
  
  return results;
}

// Dọn dẹp thư mục tạm khi khởi động
async function cleanupTempDirectory() {
  try {
    await fs.emptyDir(TEMP_DIR);
    console.log('Temporary directory cleaned');
    console.log('Đã dọn dẹp thư mục tạm');
  } catch (error) {
    console.error(`Error cleaning temporary directory: ${error.message}`);
    console.error(`Lỗi khi dọn dẹp thư mục tạm: ${error.message}`);
  }
}

// Kiểm tra cấu hình và khởi tạo các dependency
async function initialize() {
  try {
    // Dọn dẹp thư mục tạm
    await cleanupTempDirectory();
    
    // Kiểm tra thông tin xác thực OCR.space
    if (!OCR_SPACE_API_KEY) {
      console.error('OCR.space API key not found in .env file');
      console.error('Không tìm thấy API key OCR.space trong file .env');
      console.error('Please add OCR_SPACE_API_KEY to your .env file');
      console.error('Vui lòng thêm OCR_SPACE_API_KEY vào file .env của bạn');
      throw new Error('OCR.space API key not found');
    }
    
    // Kiểm tra thông tin xác thực Gemini
    if (!process.env.GEMINI_API_KEY) {
      console.error('Gemini API key not found in .env file');
      console.error('Không tìm thấy API key Gemini trong file .env');
      console.error('Please add GEMINI_API_KEY to your .env file');
      console.error('Vui lòng thêm GEMINI_API_KEY vào file .env của bạn');
      throw new Error('Gemini API key not found');
    }
    
    console.log('OCR.space and Gemini API initialized successfully');
    console.log('Khởi tạo OCR.space và Gemini API thành công');
    
    return true;
  } catch (error) {
    console.error(`Error initializing OCR module: ${error.message}`);
    console.error(`Lỗi khởi tạo module OCR: ${error.message}`);
    throw error;
  }
}

// Export các hàm
module.exports = {
  generateProductLocationWithOCR,
  cleanupTempDirectory,
  initialize
}; 