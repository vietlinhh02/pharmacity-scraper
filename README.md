# 🔍 Pharmacity Scraper

**Pharmacity Scraper** là công cụ tự động thu thập dữ liệu sản phẩm dược phẩm từ Pharmacity, sử dụng kết hợp giữa web scraping, OCR và AI để trích xuất thông tin dược phẩm một cách chính xác.

## 📋 Tính năng

- Tự động thu thập dữ liệu sản phẩm từ Pharmacity
- Sử dụng OCR.space API để phân tích hình ảnh sản phẩm
- Tích hợp Gemini AI để xác định tên thuốc và thông tin sản phẩm
- Xác định vị trí sản phẩm trong hình ảnh
- Hỗ trợ đa ngôn ngữ (cả tiếng Việt và tiếng Anh)

## 🚀 Cài đặt

1. Clone repository này
```bash
git clone https://github.com/vietlinhh02/pharmacity-scraper.git
cd pharmacity-scraper
```

2. Cài đặt các gói phụ thuộc
```bash
npm install
```

3. Tạo file .env trong thư mục gốc với các API key cần thiết
```
OCR_SPACE_API_KEY=your_ocr_space_api_key
GEMINI_API_KEY=your_gemini_api_key
```

## 🛠️ Sử dụng

Chạy ứng dụng bằng lệnh:
```bash
npm start
```

## 🔑 API Keys

Bạn cần đăng ký và lấy API key từ các dịch vụ sau:
1. [OCR.space](https://ocr.space/ocrapi) - Dịch vụ OCR
2. [Google AI Studio](https://ai.google.dev/) - Gemini AI API

## 📊 Cấu trúc dự án

```
pharmacity-scraper/
├── src/             - Mã nguồn chính
│   ├── index.js     - Điểm khởi đầu ứng dụng
│   ├── scraper.js   - Mô-đun scraping chính
│   ├── ocr.js       - Xử lý OCR và phân tích hình ảnh
│   ├── gemini.js    - Tích hợp Gemini AI
│   └── api.js       - Xử lý API 
├── temp/            - Thư mục tạm (được tạo tự động)
├── .env             - Cấu hình biến môi trường
└── package.json     - Thông tin gói và dependencies
```

## 📧 Liên hệ

[fb.com/eddiesngu](https://fb.com/eddiesngu)

## 📝 Giấy phép

ISC License 