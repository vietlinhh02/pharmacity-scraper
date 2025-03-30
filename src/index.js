const fs = require('fs-extra');
const path = require('path');
const { performance } = require('perf_hooks');
const pharmacityAPI = require('./api');
const { scrapeProduct } = require('./scraper');
const {
  generateSearchKeywords,
  generateDrugCategories,
  generateChatbotQuestions
} = require('./gemini');
const { generateProductLocationWithOCR, cleanupTempDirectory } = require('./ocr');
require('dotenv').config();

// Configuration
const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const INITIAL_SEED_KEYWORDS = [
  // Thuốc điều trị triệu chứng thông thường
  'đau đầu', 'viêm họng', 'ho', 'sốt', 'cảm cúm', 'tiêu chảy', 'đau bụng', 'nhức mỏi',
  // Thuốc kháng sinh và kháng viêm
  'kháng sinh', 'kháng viêm', 'giảm đau', 'hạ sốt', 'thuốc mỡ', 'viêm xoang', 'viêm phổi',
  // Thuốc tim mạch và huyết áp
  'tim mạch', 'huyết áp cao', 'cholesterol', 'đau thắt ngực', 'nhịp tim', 'loãng máu',
  // Thuốc tiểu đường
  'tiểu đường', 'insulin', 'đường huyết', 'tiểu đường type 2',
  // Thuốc tiêu hóa
  'dạ dày', 'trào ngược', 'táo bón', 'đại tràng', 'viêm loét dạ dày', 'khó tiêu', 'men tiêu hóa',
  // Thuốc dị ứng
  'dị ứng', 'viêm mũi', 'ngứa', 'nổi mề đay', 'viêm da', 'chàm', 'mẩn đỏ',
  // Thuốc thần kinh và não
  'an thần', 'mất ngủ', 'đau nửa đầu', 'động kinh', 'parkinson', 'alzheimer', 'co giật',
  // Thuốc hô hấp
  'hen suyễn', 'viêm phế quản', 'khó thở', 'tắc nghẽn phổi', 'COPD',
  // Vitamin và khoáng chất
  'vitamin', 'vitamin C', 'vitamin D', 'vitamin E', 'khoáng chất', 'canxi', 'sắt', 'kẽm', 'magie',
  // Thuốc bổ và tăng cường sức khỏe
  'tăng cường miễn dịch', 'bổ gan', 'thuốc bổ', 'mệt mỏi', 'suy nhược', 'tăng cân', 'giảm cân',
  // Thuốc mắt
  'đau mắt', 'khô mắt', 'viêm kết mạc', 'thuốc nhỏ mắt', 'đục thủy tinh thể', 'glaucoma',
  // Thuốc da liễu
  'mụn trứng cá', 'nấm da', 'vẩy nến', 'hắc lào', 'lang ben', 'thuốc trị sẹo',
  // Thuốc đặc trị
  'ung thư', 'thuốc ức chế miễn dịch', 'viêm khớp', 'loãng xương', 'gout', 'thấp khớp',
  // Thuốc theo giới tính
  'kinh nguyệt', 'tiền mãn kinh', 'rối loạn nội tiết', 'tiết niệu', 'tiền liệt tuyến', 'rối loạn cương',
  // Thuốc chuyên khoa khác
  'trĩ', 'giãn tĩnh mạch', 'suy tĩnh mạch', 'tai mũi họng', 'răng miệng', 'nha khoa'
];
const KEYWORDS_PER_BATCH = 20;
const MAX_PRODUCTS_PER_TERM = 50;
const DELAY_MS = 1000; // 1 second between requests
const GEMINI_DELAY_MS = 3000; // 3 seconds delay between Gemini API calls to avoid 429 errors
const IMAGE_COMPRESSION = {
  enabled: true,       // Bật/tắt tính năng nén ảnh
  quality: 70,         // Chất lượng nén (1-100, càng thấp càng nén nhiều)
  mozjpeg: true        // Sử dụng thuật toán nén mozjpeg (tốt hơn)
};

// Utility function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if product data already exists
async function productExists(slug) {
  try {
    const productDir = path.join(OUTPUT_DIR, 'products', slug);
    const dataPath = path.join(productDir, 'data.json');
    return await fs.pathExists(dataPath);
  } catch (error) {
    return false;
  }
}

// Export các cấu hình để có thể sử dụng ở các module khác
module.exports = {
  IMAGE_COMPRESSION,
  OUTPUT_DIR,
  DELAY_MS,
  GEMINI_DELAY_MS
};

// Main function
async function main() {
  console.log('Starting Pharmacity Drug Data Collector with Gemini AI...');
  console.log('Bắt đầu thu thập dữ liệu thuốc từ Pharmacity với Gemini AI...');
  const startTime = performance.now();
  
  try {
    // Khởi tạo module OCR
    console.log('Initializing OCR module...');
    console.log('Đang khởi tạo module OCR...');
    await require('./ocr').initialize();
    
    // Dọn dẹp thư mục tạm
    await cleanupTempDirectory();
  
    // Ensure output directory exists
    await fs.ensureDir(OUTPUT_DIR);
    // Đảm bảo các thư mục con cần thiết tồn tại
    await fs.ensureDir(path.join(OUTPUT_DIR, 'searches'));
    await fs.ensureDir(path.join(OUTPUT_DIR, 'products'));
    
    // Step 1: Generate search keywords using Gemini
    console.log('\nGenerating search keywords with Gemini AI...');
    console.log('Đang tạo từ khóa tìm kiếm với Gemini AI...');
    const generatedKeywords = await generateSearchKeywords(INITIAL_SEED_KEYWORDS, KEYWORDS_PER_BATCH);
    const allKeywords = [...new Set([...INITIAL_SEED_KEYWORDS, ...generatedKeywords])];
    
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'search_keywords.json'),
      JSON.stringify({ 
        seed_keywords: INITIAL_SEED_KEYWORDS,
        generated_keywords: generatedKeywords,
        all_keywords: allKeywords
      }, null, 2)
    );
    
    console.log(`Generated ${generatedKeywords.length} keywords. Total unique keywords: ${allKeywords.length}`);
    console.log(`Đã tạo ${generatedKeywords.length} từ khóa. Tổng số từ khóa duy nhất: ${allKeywords.length}`);
    
    // Step 2: Search and collect products
    const allProducts = [];
    const processedSlugs = new Set();
    
    for (const keyword of allKeywords) {
      console.log(`\nSearching for: "${keyword}"...`);
      console.log(`Đang tìm kiếm: "${keyword}"...`);
      
      try {
        const searchResults = await pharmacityAPI.searchProducts(keyword, { limit: MAX_PRODUCTS_PER_TERM });
        console.log(`Found ${searchResults.total} products, processing up to ${MAX_PRODUCTS_PER_TERM}`);
        console.log(`Tìm thấy ${searchResults.total} sản phẩm, xử lý tối đa ${MAX_PRODUCTS_PER_TERM}`);
        
        // Loại bỏ thông tin ảnh thumbnail trong kết quả tìm kiếm để không tải ảnh khi search
        if (searchResults.items) {
          searchResults.items = searchResults.items.map(item => {
            const { image, thumb_image, images, ...rest } = item;
            return rest; // Trả về item không có thông tin ảnh
          });
        }
        
        // Save search results for this keyword
        await fs.writeFile(
          path.join(OUTPUT_DIR, 'searches', `${keyword.replace(/[^a-zA-Z0-9]/g, '_')}.json`),
          JSON.stringify(searchResults, null, 2)
        );
        
        // Process each product
        for (const product of searchResults.items) {
          if (processedSlugs.has(product.slug)) {
            console.log(`  Skipping duplicate product: ${product.slug}`);
            console.log(`  Bỏ qua sản phẩm trùng lặp: ${product.slug}`);
            continue;
          }
          
          try {
            // Kiểm tra xem sản phẩm đã được tải về trước đó chưa
            const exists = await productExists(product.slug);
            if (exists) {
              console.log(`  Product already exists: ${product.slug}`);
              console.log(`  Sản phẩm đã tồn tại: ${product.slug}`);
              
              // Đọc dữ liệu sản phẩm đã có và thêm vào danh sách
              try {
                const existingData = await fs.readJson(path.join(OUTPUT_DIR, 'products', product.slug, 'data.json'));
                allProducts.push(existingData);
                processedSlugs.add(product.slug);
                continue;
              } catch (readError) {
                console.error(`  Error reading existing product data: ${readError.message}`);
                console.error(`  Lỗi khi đọc dữ liệu sản phẩm đã tồn tại: ${readError.message}`);
              }
            }
            
            console.log(`  Processing: ${product.name}`);
            console.log(`  Đang xử lý: ${product.name}`);
            const productData = await scrapeProduct(product.slug, OUTPUT_DIR);
            
            if (productData) {
              // Add search metadata
              productData.searchMetadata = {
                matchedKeyword: keyword,
                sku: product.sku,
                brand_code: product.brand_code,
                brand_name: product.brand_name,
                is_prescription_drug: product.is_prescription_drug,
                is_drug: product.is_drug
              };
              
              // Generate chatbot questions
              console.log(`  Generating chatbot questions...`);
              console.log(`  Đang tạo các câu hỏi chatbot...`);
              const questions = await generateChatbotQuestions(productData);
              if (questions.length > 0) {
                productData.chatbotQuestions = questions;
              }
              await sleep(GEMINI_DELAY_MS); // Thêm delay giữa các lệnh gọi Gemini API
              
              // Generate YOLO guidance for images using OCR instead of Gemini
              if (productData.images && productData.images.length > 0) {
                console.log(`  Generating OCR location data...`);
                console.log(`  Đang phân tích vị trí sản phẩm bằng OCR...`);
                try {
                  const locations = await generateProductLocationWithOCR(productData.images);
                  if (locations && locations.length > 0) {
                    productData.ocrLocations = locations;
                  }
                } catch (ocrError) {
                  console.error(`  Error during OCR processing: ${ocrError.message}`);
                  console.error(`  Lỗi khi xử lý OCR: ${ocrError.message}`);
                  console.error(`  OCR error details: ${ocrError.stack || 'No stack trace available'}`);
                  // Vẫn tiếp tục với phần còn lại của quá trình xử lý
                }
              }
              
              allProducts.push(productData);
              processedSlugs.add(product.slug);
              
              // Update the product's data file with enriched information
              await fs.writeFile(
                path.join(OUTPUT_DIR, 'products', product.slug, 'data.json'),
                JSON.stringify(productData, null, 2)
              );
            }
            
            await sleep(DELAY_MS);
          } catch (error) {
            console.error(`  Error processing product ${product.slug}:`, error.message);
            console.error(`  Lỗi khi xử lý sản phẩm ${product.slug}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Error processing keyword "${keyword}":`, error.message);
        console.error(`Lỗi khi xử lý từ khóa "${keyword}":`, error.message);
      }
    }
    
    // Step 3: Generate drug categories using Gemini
    if (allProducts.length > 0) {
      console.log('\nGenerating drug categories with Gemini AI...');
      console.log('Đang tạo danh mục thuốc với Gemini AI...');
      
      // Sử dụng dữ liệu từ 100 sản phẩm ngẫu nhiên để tạo danh mục để tránh quá tải Gemini API
      const maxProductsForCategories = Math.min(allProducts.length, 100);
      const selectedProducts = allProducts
        .sort(() => 0.5 - Math.random())
        .slice(0, maxProductsForCategories);
      
      const productDescriptions = selectedProducts.map(p => `${p.name}\n${p.description || ''}`);
      const categories = await generateDrugCategories(productDescriptions);
      
      // Save categorized data
      await fs.writeFile(
        path.join(OUTPUT_DIR, 'drug_categories.json'),
        JSON.stringify({
          categories,
          products: selectedProducts.map((p, i) => ({
            slug: p.slug,
            name: p.name,
            categories: Object.entries(categories)
              .filter(([_, indices]) => indices.includes(i))
              .map(([category]) => category)
          }))
        }, null, 2)
      );
    }
    
    // Save complete dataset
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'complete_dataset.json'),
      JSON.stringify({
        metadata: {
          total_products: allProducts.length,
          total_keywords: allKeywords.length,
          collection_date: new Date().toISOString(),
          execution_time_seconds: (performance.now() - startTime) / 1000
        },
        keywords: allKeywords,
        products: allProducts
      }, null, 2)
    );
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\nData collection completed in ${duration.toFixed(2)} seconds`);
    console.log(`Hoàn thành thu thập dữ liệu trong ${duration.toFixed(2)} giây`);
    console.log(`Total products collected: ${allProducts.length}`);
    console.log(`Tổng số sản phẩm đã thu thập: ${allProducts.length}`);
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log(`Thư mục lưu trữ: ${OUTPUT_DIR}`);
    
  } catch (error) {
    console.error('\nFatal error:', error);
    console.error('\nLỗi nghiêm trọng:', error);
    process.exit(1);
  }
}

// Create .env file if it doesn't exist
async function ensureEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!await fs.pathExists(envPath)) {
    console.log('Creating .env file...');
    console.log('Đang tạo file .env...');
    await fs.writeFile(envPath, 'GEMINI_API_KEY=your_api_key_here\n');
    console.error('\nPlease add your Gemini API key to the .env file before running the script.');
    console.error('\nVui lòng thêm Gemini API key của bạn vào file .env trước khi chạy ứng dụng.');
    process.exit(1);
  }
}

// Run the application
ensureEnvFile()
  .then(() => {
    if (!process.env.GEMINI_API_KEY) {
      console.error('\nGEMINI_API_KEY not found in .env file');
      console.error('\nKhông tìm thấy GEMINI_API_KEY trong file .env');
      process.exit(1);
    }
    return main();
  })
  .catch(error => {
    console.error('\nApplication error:', error);
    console.error('\nLỗi ứng dụng:', error);
    process.exit(1);
  });
