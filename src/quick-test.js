const fs = require('fs-extra');
const path = require('path');
const { performance } = require('perf_hooks');

// Simple in-memory data storage
const data = {
  products: [],
  keywords: ['đau đầu', 'viêm họng', 'ho', 'sốt']
};

// Utility function for delays
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// API request function
async function searchProducts(keyword) {
  try {
    const encodedKeyword = keyword.split('').map(char => encodeURIComponent(char)).join('');
    const url = `https://api-gateway.pharmacity.vn/pmc-ecm-product/api/public/search/index?platform=1&index=1&limit=20&total=0&refresh=true&keyword=${encodedKeyword}&order=desc&order_by=de-xuat`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error(`Error searching for "${keyword}":`, error.message);
    return { total: 0, items: [] };
  }
}

async function main() {
  console.log('Starting quick test...');
  const startTime = performance.now();
  
  // Create output directory
  const outputDir = path.join(__dirname, '..', 'data');
  await fs.ensureDir(outputDir);
  
  // Process each keyword
  for (const keyword of data.keywords) {
    console.log(`\nSearching for: "${keyword}"...`);
    
    try {
      const results = await searchProducts(keyword);
      console.log(`Found ${results.total} products`);
      
      // Save search results
      const filename = `search_${keyword.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      await fs.writeFile(
        path.join(outputDir, filename),
        JSON.stringify(results, null, 2)
      );
      
      if (results.items) {
        data.products.push(...results.items);
      }
      
      // Add delay between requests
      await sleep(1000);
    } catch (error) {
      console.error(`Error processing keyword "${keyword}":`, error);
    }
  }
  
  // Save all collected data
  await fs.writeFile(
    path.join(outputDir, 'all_data.json'),
    JSON.stringify({
      metadata: {
        total_products: data.products.length,
        collection_date: new Date().toISOString(),
        execution_time_seconds: (performance.now() - startTime) / 1000
      },
      products: data.products
    }, null, 2)
  );
  
  console.log(`\nTest completed! Collected ${data.products.length} products`);
  console.log(`Execution time: ${((performance.now() - startTime) / 1000).toFixed(2)} seconds`);
  console.log(`Data saved to: ${outputDir}`);
}

// Run the test
main().catch(console.error);
