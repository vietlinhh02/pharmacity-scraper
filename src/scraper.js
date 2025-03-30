const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

// Lấy cấu hình nén ảnh từ index.js (nếu có) hoặc sử dụng giá trị mặc định
let IMAGE_COMPRESSION;
try {
  IMAGE_COMPRESSION = require('./index').IMAGE_COMPRESSION || {
    enabled: true,
    quality: 70,
    mozjpeg: true
  };
} catch (error) {
  console.log('Using default image compression settings');
  console.log('Sử dụng cài đặt nén ảnh mặc định');
  IMAGE_COMPRESSION = {
    enabled: true,
    quality: 70,
    mozjpeg: true
  };
}

// Setup Puppeteer browser
async function setupBrowser() {
  return await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

// Compress image using sharp
async function compressImage(inputPath, options = {}) {
  // Nếu tính năng nén ảnh bị tắt, trả về ngay
  if (!IMAGE_COMPRESSION.enabled && !options.force) {
    return { success: false, skipped: true, reason: 'Image compression disabled' };
  }

  try {
    const outputPath = inputPath; // Ghi đè lên file gốc
    const quality = options.quality || IMAGE_COMPRESSION.quality;
    const useMozjpeg = options.mozjpeg !== undefined ? options.mozjpeg : IMAGE_COMPRESSION.mozjpeg;
    
    // Đọc thông tin ảnh trước khi nén
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size / 1024; // Kích thước KB
    
    // Xử lý nén ảnh với sharp
    await sharp(inputPath)
      .jpeg({ quality, mozjpeg: useMozjpeg }) // Sử dụng mozjpeg để nén tốt hơn
      .toFile(inputPath + ".tmp");
    
    // Xóa file gốc và đổi tên file đã nén
    await fs.remove(inputPath);
    await fs.move(inputPath + ".tmp", outputPath);
    
    // Đọc thông tin ảnh sau khi nén
    const compressedStats = await fs.stat(outputPath);
    const compressedSize = compressedStats.size / 1024; // Kích thước KB
    
    // Tính tỷ lệ nén
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
    
    console.log(`    Compressed image: ${path.basename(outputPath)} (${originalSize.toFixed(2)}KB → ${compressedSize.toFixed(2)}KB, ${compressionRatio}% reduction)`);
    console.log(`    Đã nén ảnh: ${path.basename(outputPath)} (${originalSize.toFixed(2)}KB → ${compressedSize.toFixed(2)}KB, giảm ${compressionRatio}%)`);
    
    return {
      success: true,
      originalSize,
      compressedSize,
      compressionRatio
    };
  } catch (error) {
    console.error(`    Error compressing image: ${error.message}`);
    console.error(`    Lỗi khi nén ảnh: ${error.message}`);
    return { 
      success: false,
      error: error.message 
    };
  }
}

// Download image
async function downloadImage(url, outputPath) {
  // Kiểm tra xem ảnh đã tồn tại chưa 
  try {
    if (await fs.pathExists(outputPath)) {
      console.log(`    Image already exists: ${path.basename(outputPath)}`);
      console.log(`    Ảnh đã tồn tại: ${path.basename(outputPath)}`);
      return { downloaded: false, exists: true };
    }
  } catch (error) {
    // Nếu có lỗi khi kiểm tra, tiếp tục tải về
    console.warn(`    Error checking image existence: ${error.message}`);
    console.warn(`    Lỗi khi kiểm tra sự tồn tại của ảnh: ${error.message}`);
  }
  
  return new Promise((resolve, reject) => {
    // Thêm timeout cho yêu cầu tải ảnh
    const request = https.get(url, { timeout: 30000 }, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve({ downloaded: true, exists: false });
      });
      
      fileStream.on('error', err => {
        fs.unlink(outputPath, () => reject(err));
      });
    }).on('error', reject);
    
    // Thêm timeout handler
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Image download timed out for: ${url}`));
    });
  });
}

// Get all product images from page
async function getProductImages(page) {
  return await page.evaluate(() => {
    const images = [];
    document.querySelectorAll('img[src*="pharmacity.io"]').forEach(img => {
      if (img.src && img.src.includes('prod-cdn.pharmacity.io')) {
        images.push({
          url: img.src,
          alt: img.alt || ''
        });
      }
    });
    return [...new Set(images.map(img => img.url))].map((url, index) => ({
      url,
      index
    }));
  });
}

// Scrape product details
async function scrapeProduct(slug, outputDir) {
  console.log(`Scraping product: ${slug}`);
  console.log(`Đang thu thập dữ liệu sản phẩm: ${slug}`);
  const browser = await setupBrowser();
  
  try {
    const page = await browser.newPage();
    const productUrl = `https://www.pharmacity.vn/${slug}.html`;
    
    await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for content to load
    await page.waitForSelector('h1.line-clamp-3', { timeout: 5000 }).catch(() => {});
    
    // Extract product data
    const productData = await page.evaluate(() => {
      const data = {};
      
      // Basic information
      data.name = document.querySelector('h1.line-clamp-3')?.textContent.trim() || 'Not found';
      data.price = document.querySelector('div[class*="text-xl"][class*="font-bold"][class*="text-primary-500"]')?.textContent.trim() || 'Not found';
      data.sku = document.querySelector('p.text-sm.leading-5.text-neutral-600')?.textContent.trim() || 'Not found';
      data.brand = document.querySelector('a.text-sm.leading-5.text-primary-500')?.textContent.replace('Thương hiệu: ', '').trim() || 'Not found';
      
      // Lấy mã SKU của sản phẩm (thường có dạng PXXXXX)
      const skuMatch = data.sku.match(/(P\d+)/i);
      const productSku = skuMatch ? skuMatch[1] : '';
      
      // Images - lấy ảnh chất lượng cao từ srcset khi cào dữ liệu chi tiết
      const images = [];
      
      if (productSku) {
        // Chỉ lấy ảnh có chứa mã SKU trong URL
        document.querySelectorAll('img[src*="pharmacity.io"]').forEach(img => {
          // Kiểm tra xem img.src hoặc srcset có chứa mã SKU không
          const isProductImage = (img.src && img.src.includes(productSku)) || 
                                (img.srcset && img.srcset.includes(productSku));
          
          if (isProductImage) {
            // Lấy đường dẫn ảnh từ thuộc tính srcset nếu có (ưu tiên ảnh độ phân giải cao)
            if (img.srcset) {
              const srcsetUrls = img.srcset.split(',')
                .map(s => s.trim().split(' ')[0])
                .filter(url => url.includes(productSku));
              
              // Lấy ảnh có độ phân giải cao nhất (thường là cuối cùng trong srcset)
              if (srcsetUrls.length > 0) {
                const highResImg = srcsetUrls[srcsetUrls.length - 1];
                if (!images.includes(highResImg)) {
                  images.push(highResImg);
                }
              }
            }
            
            // Nếu không có srcset hoặc không tìm thấy ảnh phù hợp, sử dụng src
            if (img.src && img.src.includes(productSku) && !images.includes(img.src)) {
              images.push(img.src);
            }
          }
        });
        
        // Loại bỏ các ảnh trùng lặp hoặc các kích thước khác nhau của cùng một ảnh
        // Ưu tiên giữ lại ảnh có độ phân giải lớn nhất (1080x1080)
        const uniqueImages = [];
        const imageBaseNames = new Set();
        
        // Sắp xếp để ưu tiên ảnh có độ phân giải cao
        const sortedImages = [...images].sort((a, b) => {
          const resA = a.includes('1080x1080') ? 2 : (a.includes('828x828') ? 1 : 0);
          const resB = b.includes('1080x1080') ? 2 : (b.includes('828x828') ? 1 : 0);
          return resB - resA;
        });
        
        sortedImages.forEach(url => {
          // Trích xuất tên cơ bản của file
          const fileNameMatch = url.match(/([^\/]+)(?:\.\w+)(?:\?.*)?$/);
          const baseName = fileNameMatch ? fileNameMatch[1].replace(/(_\d+)?$/, '') : '';
          
          if (baseName && !imageBaseNames.has(baseName)) {
            imageBaseNames.add(baseName);
            uniqueImages.push(url);
          }
        });
        
        data.images = uniqueImages;
      } else {
        data.images = [];
      }
      
      // Product details
      const detailsSection = Array.from(document.querySelectorAll('div[id^="radix-"]')).find(el => el.id.startsWith('radix-'));
      
      if (detailsSection) {
        // Description
        const moTa = detailsSection.querySelector('#mo-ta');
        data.description = moTa?.querySelector('p')?.textContent.trim() || 'Not found';
        
        // Ingredients
        const thanhPhan = detailsSection.querySelector('#thanh-phan');
        data.ingredients = Array.from(thanhPhan?.querySelectorAll('li') || []).map(li => li.textContent.trim());
        
        // Usage/Indications
        const chiDinh = detailsSection.querySelector('#chi-dinh');
        data.usage = Array.from(chiDinh?.querySelectorAll('li') || []).map(li => li.textContent.trim());
        
        // Usage Instructions
        const huongDan = detailsSection.querySelector('#huong-dan-su-dung');
        data.usageInstructions = Array.from(huongDan?.querySelectorAll('li') || []).map(li => li.textContent.trim());
        data.usageMethod = Array.from(huongDan?.querySelectorAll('p') || [])
          .find(p => p.textContent.includes('Dùng'))?.textContent.trim() || 'Not found';
        
        // Precautions, Side Effects, Contraindications
        const thanTrong = detailsSection.querySelector('#than-trong');
        if (thanTrong) {
          // Process each section
          const headings = Array.from(thanTrong.querySelectorAll('h2, h3'));
          
          headings.forEach(heading => {
            let nextList = heading.nextElementSibling;
            while (nextList && nextList.tagName !== 'UL') {
              nextList = nextList.nextElementSibling;
            }
            
            const items = Array.from(nextList?.querySelectorAll('li') || []).map(li => li.textContent.trim());
            
            if (heading.textContent.includes('Tác dụng phụ')) {
              data.sideEffects = items;
            } else if (heading.textContent.includes('Chống chỉ định')) {
              data.contraindications = items;
            } else if (heading.textContent.includes('Thận trọng')) {
              data.precautions = items;
            }
          });
        }
      }
      
      return data;
    });
    
    if (outputDir) {
      // Save product data
      const productDir = path.join(outputDir, 'products', slug);
      await fs.ensureDir(productDir);
      
      await fs.writeFile(
        path.join(productDir, 'data.json'),
        JSON.stringify(productData, null, 2)
      );
      
      // Download images - chỉ tải ảnh khi cào dữ liệu chi tiết sản phẩm
      if (productData.images && productData.images.length > 0) {
        const imagesDir = path.join(productDir, 'images');
        await fs.ensureDir(imagesDir);
        
        console.log(`  Downloading ${productData.images.length} images from product details...`);
        console.log(`  Đang tải ${productData.images.length} ảnh từ thông tin chi tiết sản phẩm...`);
        
        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        
        for (let i = 0; i < productData.images.length; i++) {
          const imageUrl = productData.images[i];
          const imagePath = path.join(imagesDir, `image_${i}.jpg`);
          
          try {
            // Tải ảnh
            const downloadResult = await downloadImage(imageUrl, imagePath);
            
            // Nếu ảnh được tải mới hoặc đã tồn tại, thử nén
            if (downloadResult.downloaded) {
              // Ảnh mới tải về, tiến hành nén
              const compressionResult = await compressImage(imagePath);
              if (compressionResult.success) {
                successCount++;
                totalOriginalSize += compressionResult.originalSize;
                totalCompressedSize += compressionResult.compressedSize;
              } else {
                // Nén thất bại nhưng ảnh đã tải thành công
                successCount++;
              }
            } else if (downloadResult.exists) {
              skipCount++;
            }
          } catch (error) {
            console.error(`    Error downloading image ${i}: ${error.message}`);
            console.error(`    Lỗi khi tải ảnh ${i}: ${error.message}`);
            failCount++;
          }
          
          // Thêm delay nhỏ giữa các lần tải ảnh để tránh tải quá nhiều cùng lúc
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log(`  Image download results: ${successCount} success, ${skipCount} skipped, ${failCount} failed`);
        console.log(`  Kết quả tải ảnh: ${successCount} thành công, ${skipCount} bỏ qua, ${failCount} thất bại`);
        
        if (totalOriginalSize > 0) {
          const overallReduction = ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(2);
          console.log(`  Total space saved: ${(totalOriginalSize - totalCompressedSize).toFixed(2)}KB (${overallReduction}% reduction)`);
          console.log(`  Tổng dung lượng tiết kiệm: ${(totalOriginalSize - totalCompressedSize).toFixed(2)}KB (giảm ${overallReduction}%)`);
        }
      }
    }
    
    return productData;
  } catch (error) {
    console.error(`Error scraping ${slug}:`, error.message);
    console.error(`Lỗi khi thu thập dữ liệu ${slug}:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeProduct, downloadImage };
