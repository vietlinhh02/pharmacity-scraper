const fs = require('fs-extra');
const path = require('path');
const { performance } = require('perf_hooks');
const https = require('https');
const { scrapeProduct } = require('./scraper');

// Configuration
const config = {
  keywords: [
    'đau đầu', 'viêm họng', 'ho', 'sốt', 'cảm cúm', 'tiêu chảy',
    'đau bụng', 'nhức mỏi', 'dị ứng', 'vitamin', 'thuốc bổ'
  ],
  delay: 1000,
  maxProductsPerKeyword: 20,
  outputDir: path.join(__dirname, '..', 'data')
};

// Utility functions
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// API request functions
async function searchProducts(keyword) {
  try {
    const encodedKeyword = keyword.split('').map(char => encodeURIComponent(char)).join('');
    const url = `https://api-gateway.pharmacity.vn/pmc-ecm-product/api/public/search/index?platform=1&index=1&limit=${config.maxProductsPerKeyword}&total=0&refresh=true&keyword=${encodedKeyword}&order=desc&order_by=de-xuat`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    // Loại bỏ thông tin ảnh thumbnail trong kết quả tìm kiếm để không tải ảnh khi search
    if (data.data && data.data.items) {
      data.data.items = data.data.items.map(item => {
        const { images, ...rest } = item;
        return rest; // Trả về item không có thông tin ảnh
      });
    }
    
    return data.data;
  } catch (error) {
    console.error(`Error searching for "${keyword}":`, error.message);
    return { total: 0, items: [] };
  }
}

async function getProductDetails(slug) {
  try {
    const url = `https://api-gateway.pharmacity.vn/pmc-ecm-product/api/public/product/${slug}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error(`Error fetching details for ${slug}:`, error.message);
    return null;
  }
}

async function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });
      
      fileStream.on('error', err => {
        fs.unlink(outputPath, () => reject(err));
      });
    }).on('error', reject);
  });
}

// Process and save product data
async function processProduct(product, keyword) {
  const productDir = path.join(config.outputDir, 'products', product.slug);
  await fs.ensureDir(productDir);
  
  // Scrape detailed product data using the scraper
  const productData = await scrapeProduct(product.slug, productDir);
  
  if (!productData) {
    console.error(`  Failed to scrape product: ${product.slug}`);
    return null;
  }
  
  // Combine search metadata with scraped data
  const enhancedProduct = {
    ...productData,
    search_metadata: {
      keyword,
      sku: product.sku,
      brand_code: product.brand_code,
      brand_name: product.brand_name,
      is_prescription_drug: product.is_prescription_drug,
      is_drug: product.is_drug,
      found_date: new Date().toISOString()
    }
  };
  
  // Save updated product data
  await fs.writeFile(
    path.join(productDir, 'data.json'),
    JSON.stringify(enhancedProduct, null, 2)
  );
  
  return enhancedProduct;
}

async function main() {
  console.log('Starting data collection...');
  const startTime = performance.now();
  
  // Create output directories
  await fs.ensureDir(config.outputDir);
  await fs.ensureDir(path.join(config.outputDir, 'products'));
  await fs.ensureDir(path.join(config.outputDir, 'searches'));
  
  const collectedData = {
    products: [],
    search_results: {}
  };
  
  // Process each keyword
  for (const keyword of config.keywords) {
    console.log(`\nSearching for: "${keyword}"...`);
    
    try {
      const results = await searchProducts(keyword);
      console.log(`Found ${results.total} products, processing ${results.items.length}`);
      
      // Save search results (without images)
      const searchFilename = `search_${keyword.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      await fs.writeFile(
        path.join(config.outputDir, 'searches', searchFilename),
        JSON.stringify(results, null, 2)
      );
      
      collectedData.search_results[keyword] = {
        total_found: results.total,
        processed: results.items.length
      };
      
      // Process each product
      for (const product of results.items) {
        console.log(`  Processing: ${product.name}`);
        try {
          const processedProduct = await processProduct(product, keyword);
          collectedData.products.push(processedProduct);
        } catch (error) {
          console.error(`  Error processing product ${product.slug}:`, error.message);
        }
        await sleep(config.delay);
      }
    } catch (error) {
      console.error(`Error processing keyword "${keyword}":`, error);
    }
  }
  
  // Save collection summary
  await fs.writeFile(
    path.join(config.outputDir, 'collection_summary.json'),
    JSON.stringify({
      metadata: {
        total_products: collectedData.products.length,
        keywords_processed: config.keywords.length,
        collection_date: new Date().toISOString(),
        execution_time_seconds: (performance.now() - startTime) / 1000
      },
      search_results: collectedData.search_results,
      products: collectedData.products.map(p => ({
        slug: p.slug,
        name: p.name,
        search_keyword: p.search_keyword,
        images_count: p.images.length
      }))
    }, null, 2)
  );
  
  console.log(`\nCollection completed!`);
  console.log(`Total products collected: ${collectedData.products.length}`);
  console.log(`Execution time: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds`);
  console.log(`Data saved to: ${config.outputDir}`);
}

// Run the collection
main().catch(console.error);
