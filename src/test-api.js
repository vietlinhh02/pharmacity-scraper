const https = require('https');

function searchProducts(keyword) {
  return new Promise((resolve, reject) => {
    const encodedKeyword = keyword.split('').map(char => encodeURIComponent(char)).join('');
    const url = `https://api-gateway.pharmacity.vn/pmc-ecm-product/api/public/search/index?platform=1&index=1&limit=20&total=0&refresh=true&keyword=${encodedKeyword}&order=desc&order_by=de-xuat`;
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve(parsedData);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Test the API
async function test() {
  try {
    console.log('Testing Pharmacity API...');
    const result = await searchProducts('đau đầu');
    console.log('API Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
