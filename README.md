# Luxora Gems

> E-commerce platform for jewelry and accessories with admin panel, vendor portal, and stock synchronization.

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green?style=flat&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-black?style=flat&logo=express)](https://expressjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=flat&logo=docker)](https://www.docker.com/)
[![JavaScript](https://img.shields.io/badge/Vanilla%20JS-ES6+-yellow?style=flat&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

Full-stack e-commerce solution with product catalog, shopping cart, admin dashboard, PDF catalog generation, and external stock sync tools.

---

## Features

### Public Store
- Category & subcategory navigation
- Full-text search (by reference, name, category)
- Price filtering & sorting
- Progressive image loading (lazy load, batch rendering)
- Shopping cart with localStorage persistence
- PDF catalog export
- WhatsApp integration

### Admin Panel
- Excel bulk import (`.xlsx` → products)
- Full CRUD for products
- Image cache management
- Featured & New products management
- Contact number management
- Password & 2FA authentication
- Accounts receivable dashboard (cartera)

### Vendor Portal
- PDF catalog with images
- Bulk photo download (ZIP)
- DIAN invoice processing (PDF → purchase order with 2.5× multiplier)

### External Tools
- **Go Desktop App**: Standalone stock sync from `.dat` files
- **Python GUI**: Cross-platform Tkinter updater

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Backend | Express.js |
| Image Processing | Sharp |
| Excel Parsing | xlsx |
| PDF Generation | PDFKit |
| 2FA | Speakeasy + QRCode |
| Frontend | Vanilla JS, HTML5, CSS3 |
| Container | Docker |

---

## Quick Start

```bash
# Clone repository
git clone https://github.com/yourusername/luxora-gems.git
cd luxora-gems

# Start with Docker
docker-compose up -d

# Access
# Store:    http://localhost:3000
# Admin:    http://localhost:3000/admin/
```

### Default Credentials

| Role | Password |
|------|----------|
| Admin | `1234` |
| Vendor | `123` |
| User | `123` |

---

## Project Structure

```
luxora-gems/
├── backend/              # Express server
│   ├── server.js          # Main application
│   ├── Dockerfile        # Container definition
│   └── package.json
├── frontend/              # Public store
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── admin/            # Admin panel
├── bd/                   # Desktop stock updaters
│   ├── main.go           # Go app
│   └── actualizador.py  # Python Tkinter
├── imagenes/             # Product images (categorized)
├── docker-compose.yml
└── *.json               # Data files
```

---

## API Highlights

- `GET /api/productos` - Full catalog
- `POST /api/admin/importar` - Excel import
- `POST /api/catalogo/pdf` - Generate PDF catalog
- `POST /api/existencias` - Stock sync (external apps)
- `POST /api/admin/login/2fa` - Two-factor authentication

---

## Screenshots

![Storefront](https://via.placeholder.com/800x400?text=Luxora+Gems+Storefront)
![Admin Panel](https://via.placeholder.com/800x400?text=Admin+Panel)

---

## License

MIT

---

Built with ❤️ for portfolio purposes