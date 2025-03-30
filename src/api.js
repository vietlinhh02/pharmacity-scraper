const axios = require('axios');

class PharmacityAPI {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://api-gateway.pharmacity.vn',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  async searchProducts(keyword, { page = 1, limit = 20 } = {}) {
    try {
      const response = await this.client.get('/pmc-ecm-product/api/public/search/index', {
        params: {
          platform: 1,
          index: page,
          limit,
          total: 0,
          refresh: true,
          keyword: keyword.split('').map(char => encodeURIComponent(char)).join(''),
          order: 'desc',
          order_by: 'de-xuat'
        }
      });
      
      const searchData = response.data.data;
      
      // Loại bỏ thông tin ảnh thumbnail trong kết quả tìm kiếm
      if (searchData && searchData.items) {
        searchData.items = searchData.items.map(item => {
          const { image, thumb_image, images, ...rest } = item;
          return rest; // Trả về item không có thông tin ảnh
        });
      }
      
      return searchData;
    } catch (error) {
      console.error(`Error searching for "${keyword}":`, error.message);
      return { total: 0, items: [] };
    }
  }

  async getProductBySlug(slug) {
    try {
      const response = await this.client.get(`/pmc-ecm-product/api/public/product/${slug}`);
      return response.data.data;
    } catch (error) {
      console.error(`Error fetching product "${slug}":`, error.message);
      return null;
    }
  }
}

module.exports = new PharmacityAPI();
