const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Utility function to wait
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry function with exponential backoff
async function withRetry(fn, maxRetries = 3, initialDelay = 5000) {
  let retries = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      
      // Log error but don't retry if it's not a rate limit error
      if (!(error.message.includes('429') || error.message.includes('rate limit') || error.message.includes('Too Many Requests'))) {
        console.error('Gemini API error:', error.message);
        console.error('Lỗi Gemini API:', error.message);
        
        // If we've reached max retries, throw
        if (retries >= maxRetries) {
          throw error;
        }
      } else {
        // If it's a rate limit error, log it and retry with backoff
        const delay = initialDelay * Math.pow(2, retries - 1);
        console.warn(`Rate limit exceeded, retrying in ${delay/1000} seconds... (Attempt ${retries}/${maxRetries})`);
        console.warn(`Đã vượt quá giới hạn tỷ lệ, thử lại sau ${delay/1000} giây... (Lần thử ${retries}/${maxRetries})`);
        
        await sleep(delay);
        
        // If we've reached max retries, throw
        if (retries >= maxRetries) {
          throw new Error(`Failed after ${maxRetries} retries due to rate limiting.`);
        }
      }
    }
  }
}

// Generate medication-related search keywords
async function generateSearchKeywords(seed = [], count = 20) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    In Vietnam, I'm collecting data about medications from Pharmacity.
    (Tôi đang thu thập dữ liệu về thuốc từ Pharmacity tại Việt Nam.)
    
    ${seed.length > 0 ? `I already have these keywords: ${seed.join(', ')}` : ''}
    ${seed.length > 0 ? `Tôi đã có những từ khóa sau: ${seed.join(', ')}` : ''}
    
    Generate ${count} Vietnamese search keywords related to different medical conditions, symptoms, or medication types that people might search for at a pharmacy.
    (Tạo ${count} từ khóa tìm kiếm bằng tiếng Việt liên quan đến các tình trạng y tế, triệu chứng, hoặc loại thuốc khác nhau mà mọi người có thể tìm kiếm tại nhà thuốc.)
    
    Return only a JSON array of strings without any other text. 
    Example format: ["keyword1", "keyword2", "keyword3"]
    (Chỉ trả về một mảng JSON của các chuỗi mà không có bất kỳ văn bản nào khác.)
    
    Make sure to include a diverse range of medical conditions, common health issues, and medication categories.
    (Đảm bảo bao gồm nhiều loại tình trạng y tế, vấn đề sức khỏe phổ biến và các danh mục thuốc đa dạng.)
    `;
    
    return await withRetry(async () => {
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      // Extract JSON array from response
      const jsonMatch = response.match(/\[.*\]/s);
      if (!jsonMatch) {
        throw new Error('Failed to parse keywords from Gemini response');
      }
      
      return JSON.parse(jsonMatch[0]);
    });
    
  } catch (error) {
    console.error('Error generating keywords with Gemini:', error);
    console.error('Lỗi khi tạo từ khóa với Gemini:', error);
    return [];
  }
}

// Generate drug categories from product data
async function generateDrugCategories(productDescriptions) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    I have collected descriptions of different medications from a pharmacy.
    (Tôi đã thu thập mô tả về các loại thuốc khác nhau từ nhà thuốc.)
    
    Based on these descriptions, categorize them into logical drug categories.
    (Dựa trên những mô tả này, hãy phân loại chúng thành các danh mục thuốc hợp lý.)
    
    Descriptions:
    ${productDescriptions.join('\n\n')}
    
    Return a JSON object where keys are category names and values are arrays of indices
    corresponding to the order of the descriptions I provided.
    (Trả về một đối tượng JSON trong đó các khóa là tên danh mục và giá trị là mảng các chỉ số
    tương ứng với thứ tự của các mô tả tôi đã cung cấp.)
    Example format: 
    {
      "Pain Relief": [0, 3, 5],
      "Antibiotics": [1, 6],
      "Cold & Flu": [2, 4]
    }
    `;
    
    return await withRetry(async () => {
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      // Extract JSON object from response
      const jsonMatch = response.match(/\{.*\}/s);
      if (!jsonMatch) {
        throw new Error('Failed to parse categories from Gemini response');
      }
      
      return JSON.parse(jsonMatch[0]);
    });
    
  } catch (error) {
    console.error('Error generating categories with Gemini:', error);
    console.error('Lỗi khi tạo danh mục với Gemini:', error);
    return {};
  }
}

// Generate YOLO annotation guidance
async function generateYOLOGuidance(imageUrl, productName) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    This is an image of a medication product called "${productName}".
    (Đây là hình ảnh của sản phẩm thuốc có tên "${productName}".)
    
    For YOLO object detection training, I need to know the approximate bounding box 
    of the main product in this image.
    (Để huấn luyện nhận dạng đối tượng YOLO, tôi cần biết hộp giới hạn gần đúng
    của sản phẩm chính trong hình ảnh này.)
    
    Return only a JSON object with x_center, y_center, width, and height values 
    as normalized coordinates (0.0-1.0).
    (Chỉ trả về một đối tượng JSON với các giá trị x_center, y_center, width và height
    dưới dạng tọa độ chuẩn hóa (0.0-1.0).)
    Example format: {"x_center": 0.5, "y_center": 0.5, "width": 0.8, "height": 0.8}
    
    Note: Don't analyze the text on the product, just provide appropriate bounding box values.
    (Lưu ý: Đừng phân tích văn bản trên sản phẩm, chỉ cần cung cấp giá trị hộp giới hạn thích hợp.)
    `;
    
    return await withRetry(async () => {
      const result = await model.generateContent([prompt, imageUrl]);
      const response = result.response.text();
      
      // Extract JSON object from response
      const jsonMatch = response.match(/\{.*\}/s);
      if (!jsonMatch) {
        throw new Error('Failed to parse YOLO guidance from Gemini response');
      }
      
      return JSON.parse(jsonMatch[0]);
    }, 3, 10000); // Tăng thời gian chờ cho xử lý hình ảnh lên 10s và retry 3 lần
    
  } catch (error) {
    console.error('Error generating YOLO guidance with Gemini:', error);
    console.error('Lỗi khi tạo hướng dẫn YOLO với Gemini:', error);
    return { x_center: 0.5, y_center: 0.5, width: 0.8, height: 0.8 }; // Default fallback
  }
}

// Generate potential questions for chatbot training
async function generateChatbotQuestions(productData) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    I have information about a medication:
    (Tôi có thông tin về một loại thuốc:)
    
    Name (Tên): ${productData.name}
    Description (Mô tả): ${productData.description || 'N/A'}
    Ingredients (Thành phần): ${Array.isArray(productData.ingredients) ? productData.ingredients.join(', ') : 'N/A'}
    Usage (Công dụng): ${Array.isArray(productData.usage) ? productData.usage.join(', ') : 'N/A'}
    Side Effects (Tác dụng phụ): ${Array.isArray(productData.sideEffects) ? productData.sideEffects.join(', ') : 'N/A'}
    
    Generate 10 potential questions that patients might ask about this medication for chatbot training.
    Generate 5 questions in Vietnamese and 5 questions in English.
    (Tạo 10 câu hỏi tiềm năng mà bệnh nhân có thể hỏi về loại thuốc này để huấn luyện chatbot.
    Tạo 5 câu hỏi bằng tiếng Việt và 5 câu hỏi bằng tiếng Anh.)
    
    Return only a JSON array of strings without any other text.
    (Chỉ trả về một mảng JSON của các chuỗi mà không có bất kỳ văn bản nào khác.)
    Example format: ["Question 1?", "Question 2?", "Question 3?"]
    `;
    
    return await withRetry(async () => {
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      // Extract JSON array from response
      const jsonMatch = response.match(/\[.*\]/s);
      if (!jsonMatch) {
        throw new Error('Failed to parse questions from Gemini response');
      }
      
      return JSON.parse(jsonMatch[0]);
    });
    
  } catch (error) {
    console.error('Error generating chatbot questions with Gemini:', error);
    console.error('Lỗi khi tạo câu hỏi chatbot với Gemini:', error);
    return [];
  }
}

module.exports = {
  generateSearchKeywords,
  generateDrugCategories,
  generateYOLOGuidance,
  generateChatbotQuestions
};
