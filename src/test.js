const pharmacityAPI = require('./api');
const { scrapeProduct } = require('./scraper');

async function testScraper() {
  try {
    // Test search API with a Vietnamese keyword
    console.log('Testing search API...');
    const searchResults = await pharmacityAPI.searchProducts('đau đầu');
    console.log(`Found ${searchResults.total} products`);
    
    if (searchResults.items && searchResults.items.length > 0) {
      // Test scraping the first product
      const firstProduct = searchResults.items[0];
      console.log(`Testing scraper with product: ${firstProduct.name}`);
      
      const productData = await scrapeProduct(firstProduct.slug, './data');
      if (productData) {
        console.log('Successfully scraped product data:');
        console.log(JSON.stringify(productData, null, 2));
      }
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testScraper();
