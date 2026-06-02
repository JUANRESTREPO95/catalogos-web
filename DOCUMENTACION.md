# Luxora Gems — Full-Stack E-Commerce Platform

> A complete, production-ready web application for managing and showcasing a jewelry and accessories catalog. Built with **Node.js**, **Express**, and **vanilla JavaScript**.

---

##  Table of Contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Architecture](#5-architecture)
6. [API Reference](#6-api-reference)
7. [Authentication & Security](#7-authentication--security)
8. [Custom Tools](#8-custom-tools)
9. [Data & Storage](#9-data--storage)
10. [Image Pipeline](#10-image-pipeline)
11. [PDF Generation](#11-pdf-generation)
12. [Getting Started](#12-getting-started)
13. [Administrator Guide](#13-administrator-guide)

---

## 1. Overview

**Luxora Gems** is a dual-interface web platform that combines a public-facing product catalog with a full-featured administration panel. It allows businesses to manage inventory, track accounts receivable (*cartera*), generate professional PDF catalogs, process invoices, and sync stock levels with external point-of-sale systems.

The entire backend runs inside a single Docker container, making deployment straightforward.

---

## 2. Features

### Public Catalog (`/`)

- **Category & Subcategory Navigation** — Hierarchical sidebar filter system
- **Full-Text Search** — Search by reference, product name, category, or subcategory
- **Price Filtering & Sorting** — Ascending/descending price sort, min/max range filter
- **Progressive Image Loading** — Lazy-loaded product cards with batch rendering (60 items per batch)
- **Shopping Cart** — Client-side cart with local storage persistence
- **PDF Catalog Export** — Generates a print-ready PDF of the current filtered view
- **Image Modal** — Full-screen product preview with swipe navigation (mobile)
- **WhatsApp Integration** — One-tap contact buttons linked to registered phone numbers
- **Manifest Download** — Vendors can download associated PDF manifests for products

### Administration Panel (`/admin/`)

- **Excel Import** — Bulk-import products from `.xlsx` files (columns: Reference, Name, Price)
- **Product CRUD** — Create, read, update, and delete products in the catalog
- **Image Cache Management** — Clear or regenerate optimized image cache on demand
- **Clean Up Orphans** — Remove products without an associated image in a single click
- **Featured & New Products** — Toggle products as "Best Sellers" or "New Arrivals"; import via Excel
- **Contact Number Management** — Manage WhatsApp contact numbers and introduction text
- **Manifest Management** — Upload Excel files to associate PDF manifests with product references
- **Password Management** — Change credentials for Admin, Vendor, and User roles
- **Two-Factor Authentication** — Optional 2FA via Google Authenticator (Admin only)
- **Accounts Receivable Dashboard** — View sales totals, balances, aging summaries, and per-seller charts

### Vendor Portal

- **PDF Catalog Export** — Authenticated vendors can download a visual catalog with product images
- **Bulk Photo Download** — Download filtered product images as a ZIP archive
- **Invoice Processing** — Upload DIAN-format PDF invoices; the system parses items and generates a combined purchase order with a 2.5× price multiplier

### External Tools (Desktop Applications)

- **Go Desktop App** — A standalone executable that reads `.dat` files from a local accounting system, matches references against the web catalog, and pushes inventory updates via the API
- **Python GUI App** — Equivalent functionality with a Tkinter graphical interface; cross-platform (Windows, macOS, Linux)

---

## 3. Tech Stack

### Backend

| Technology | Purpose |
|---|---|
| **Node.js** | Runtime environment |
| **Express** | Web framework & API routing |
| **sharp** | High-performance image processing & caching |
| **xlsx** | Excel file parsing (.xlsx / .csv) |
| **PDFKit** | Server-side PDF generation (orders, catalogs) |
| **pdf-parse** | DIAN invoice PDF text extraction |
| **speakeasy** | TOTP-based two-factor authentication |
| **qrcode** | QR code generation for 2FA setup |
| **multer** | Multipart file upload handling |
| **Docker** | Containerization & deployment |

### Frontend

| Technology | Purpose |
|---|---|
| **HTML5** | Semantic markup |
| **CSS3** | Custom styling with CSS custom properties |
| **Vanilla JavaScript (ES6+)** | All interactivity — no frameworks |
| **Google Fonts** | *Cormorant Garamond* (serif) + *Jost* (sans-serif) |
| **Intersection Observer API** | Infinite scroll product loading |
| **localStorage** | Client-side cart persistence |

### Infrastructure

| Component | Details |
|---|---|
| **Containerization** | Docker + Docker Compose |
| **Port** | 3000 (configurable via `PORT`) |
| **Network** | `host` mode for low-latency IPC |
| **Persistence** | JSON files mounted as volumes |

---

## 4. Project Structure

```
luxora-gems/
├── backend/                         # Node.js/Express server
│   ├── server.js                    # Application entry point (~1235 lines)
│   ├── Dockerfile                   # Docker image definition
│   ├── package.json                 # Dependencies
│   └── data/                        # (runtime) Mounted JSON files & images
├── frontend/                        # Public web interface
│   ├── index.html                   # Catalog page (~420 lines)
│   ├── app.js                       # Public logic (~1326 lines)
│   ├── style.css                    # Global styles (~1875 lines)
│   └── admin/                       # Administration panel
│       ├── index.html               # Admin page (~638 lines)
│       ├── admin.js                 # Admin logic (~906 lines)
│       └── admin.css                # Admin-specific styles
├── bd/                              # Standalone desktop stock updaters
│   ├── main.go                      # Go executable (cross-platform)
│   └── actualizador.py              # Python Tkinter GUI
├── imagenes/                        # Original product images (categorized)
├── imagenes_cache/                  # Optimized WebP + JPEG cache
├── manifiestos/                     # PDF manifests by reference
├── docker-compose.yml               # Docker orchestration
├── productos.json                   # Product catalog [{ref, nombre, precio}]
├── claves.json                      # Credentials & 2FA secrets
├── destacados.json                  # Best-seller reference list
├── nuevos.json                      # New-arrival reference list
├── contactos.json                   # Contact introduction + phone numbers
├── manifiestos.json                 # Reference-to-PDF mapping
└── ubicaciones_vendedor.json        # Vendor login geo-history
```

---

## 5. Architecture

```
┌──────────────┐     HTTP/WS     ┌──────────────────┐     File System     ┌──────────────┐
│   Frontend   │ ──────────────> │   Express API    │ ──────────────────> │  JSON Files  │
│  (Vanilla)   │ <────────────── │   (server.js)    │ <────────────────── │   (Data)     │
└──────────────┘                 └──────────────────┘                     └──────────────┘
       │                                │                                        │
       │                                ├── /imagenes/ (original)                │
       │                                ├── /imagenes_cache/ (WebP + JPEG)       │
       │                                ├── /manifiestos/ (PDFs)                 │
       │                                └── /agotados/ (removed product images)  │
       │                                                                            │
       v                                v                                            v
┌──────────────┐                 ┌──────────────────┐
│  Desktop App │ ──────────────> │  /api/existencias│
│  (Go/Python) │                 │  (Stock Sync)    │
└──────────────┘                 └──────────────────┘
```

**Design Decisions:**

- **No database server** — JSON files are used for simplicity and zero-dependency deployments. Suitable for catalogs with up to ~10,000 products.
- **Image-derived categorization** — Categories and subcategories are inferred from the filesystem structure of `/imagenes/`, eliminating the need for a separate taxonomy table.
- **Pre-computed image cache** — All images are resized and converted to WebP (web) and JPEG (PDF) at startup using `sharp`, with a file-watcher for new additions.
- **Role-based access** — Three authentication tiers with granular permissions; 2FA available for the admin role.

---

## 6. API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/login` | Admin login (returns 400 with `requires2FA` if 2FA is enabled) |
| `POST` | `/api/admin/login/2fa` | Admin login with 2FA code |
| `POST` | `/api/vendedor/login` | Vendor login (logs IP + geo-location) |
| `POST` | `/api/usuario/login` | User login (limited access) |

### Catalog

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/productos` | Full product list (enriched with image, category, stock, featured/new flags) |
| `GET` | `/api/productos/refs` | Returns only reference strings (used by desktop apps) |
| `GET` | `/api/categorias` | Category tree derived from image folder structure |

### Administration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/productos` | ✓ | Raw product list |
| `POST` | `/api/admin/productos` | ✓ | Create a single product |
| `PUT` | `/api/admin/productos/:ref` | ✓ | Update product name/price |
| `DELETE` | `/api/admin/productos/:ref` | ✓ | Delete product + image + cache |
| `POST` | `/api/admin/importar` | ✓ | Bulk import from Excel |
| `POST` | `/api/admin/limpiar` | ✓ | Remove products without images |
| `POST` | `/api/admin/limpiar-cache` | ✓ | Clear and regenerate image cache |
| `POST` | `/api/admin/claves` | ✓ | Change passwords |
| `GET` | `/api/admin/agotados/categorias` | ✓ | List categories with removed products |
| `GET` | `/api/admin/agotados/:categoria` | ✓ | List images in a removed-products category |

### Featured / New Products

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/destacados` | ✓ | List best-seller references |
| `POST` | `/api/destacados/toggle` | ✓ | Toggle a product's featured status |
| `POST` | `/api/destacados/importar` | ✓ | Bulk import featured from Excel |
| `GET` | `/api/nuevos` | ✓ | List new-arrival references |
| `POST` | `/api/nuevos/toggle` | ✓ | Toggle a product's new status |
| `POST` | `/api/nuevos/importar` | ✓ | Bulk import new arrivals from Excel |

### Accounts Receivable (Cartera)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cartera-mock?action=cartera` | Simulated portfolio ledger (for portfolio/demo) |
| `GET` | `/api/cartera-mock?action=costos` | Simulated cost data |

### PDF Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/pedido/pdf` | Generate a purchase-order PDF from cart items |
| `POST` | `/api/catalogo/pdf` | Generate a visual catalog PDF with product images |
| `POST` | `/api/vendedor/facturas` | Upload DIAN invoice PDFs; returns combined purchase order |

### Manifests

| Method | Endpoint | Description |
|--------|----------|-------------|
| `HEAD` | `/api/manifiestos/:ref` | Check if a manifest PDF exists for a reference |
| `GET` | `/api/manifiestos/:ref` | Download manifest PDF |
| `GET` | `/api/admin/manifiestos` | List all manifest entries |
| `POST` | `/api/admin/manifiestos/importar` | Bulk import manifest mappings from Excel |

### Stock Sync

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/existencias` | API key | Receive inventory updates from desktop apps |

### Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/imagenes/*path` | Optimized image served as WebP with caching |

---

## 7. Authentication & Security

### Role Hierarchy

| Role | Catalog View | PDF Export | Product CRUD | Password Mgmt | Cartera | 2FA |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✓ | ✓ | ✓ | ✓ (all) | ✓ | ✓ (optional) |
| **Vendor** | ✓ | ✓ | — | — | — | — |
| **User** | ✓ | — | ✓ | ✓ (self + vendor) | — | — |

### Two-Factor Authentication (2FA)

- Optional TOTP-based authentication using **speakeasy** + **QRCode**
- Flow: `/api/admin/2fa/setup` → scan QR → `/api/admin/2fa/verify` → enabled
- Login flow: password → `/api/admin/login` returns `requires2FA` → prompt for code → `/api/admin/login/2fa`

### Vendor Tracking

When a vendor logs in via `POST /api/vendedor/login`, the server:
1. Resolves the IP address via **ip-api.com** (city, region, country)
2. Appends the timestamp, IP, and location to `ubicaciones_vendedor.json`

### CORS

- Hard-coded to a single allowed origin (configurable in `backend/server.js`)
- Preflight `OPTIONS` requests from unauthorized origins are rejected with `403`

---

## 8. Custom Tools

### Go Desktop Application (`bd/main.go`)

A standalone HTTP server that opens a browser-based UI for selecting a `.dat` file from a local accounting system.

**Workflow:**
1. Reads the `.dat` file using a custom dBase parser (360-byte records, field descriptors at `0x200`)
2. Fetches the valid reference list from `GET /api/productos/refs`
3. Collates inventory counts using multiple candidate reference formats (with and without hyphens)
4. Sends matched items to `POST /api/existencias` for the remote catalog

### Python Desktop Application (`bd/actualizador.py`)

Functional equivalent of the Go app with a native Tkinter GUI.

**Platform Support:**
- Windows: Opens in Microsoft Edge / Chrome app mode
- macOS: Opens in Safari
- Linux: Opens via `xdg-open`

---

## 9. Data & Storage

### File-Based Database

All persistent data is stored in JSON files mounted as Docker volumes:

| File | Type | Description |
|------|------|-------------|
| `productos.json` | `[{ref, nombre, precio}]` | Core product catalog |
| `claves.json` | `{admin, vendedor, usuario, admin2FA}` | Credentials + 2FA config |
| `destacados.json` | `[string]` | Best-seller reference array |
| `nuevos.json` | `[string]` | New-arrival reference array |
| `contactos.json` | `{introduccion, contactos[]}` | Contact page data |
| `manifiestos.json` | `[{referencia, manifiesto}]` | Reference ↔ PDF mapping |
| `ubicaciones_vendedor.json` | `[{fecha, ip, ciudad}]` | Vendor login history |
| `existencias.json` | `{ref: number}` | Real-time stock counts |

### Image Folder Structure

```
imagenes/
├── Categoria1/
│   ├── SubcategoriaA/
│   │   ├── REF001.jpg
│   │   └── REF002.png
│   └── SubcategoriaB/
└── Categoria2/
```

The filesystem path determines the product's `categoria` and `subcategoria`. The filename (without extension) becomes the product reference. This convention ensures zero-configuration image management.

### Image Cache

Two formats are generated for each image:

| Format | File Pattern | Width | Quality | Purpose |
|--------|-------------|-------|---------|---------|
| WebP | `{path}_w800.webp` | 800px | 88% | Web display |
| JPEG | `{path}_w800.jpg` | 800px | 88% | PDF catalog embedding |

Cache generation runs:
- At **startup** (batch, 8 concurrent workers)
- On **demand** via `/api/admin/limpiar-cache`
- Automatically via **file watcher** when new images are added to `/imagenes/`

---

## 10. Image Pipeline

```
Original Image (any format)
         │
         ▼
   sharp.resize({ width: 800, withoutEnlargement: true })
         │
         ├──► .webp({ quality: 88 }) ──► imagenes_cache/{hash}_w800.webp
         │
         └──► .jpeg({ quality: 88 }) ──► imagenes_cache/{hash}_w800.jpg
```

- **On-the-fly generation**: If a cache miss occurs, the image is processed synchronously and served immediately.
- **Memory-mapped cache**: An in-memory map (`_mapaCache`) is populated on first request and invalidated when images change.
- **Concurrent processing**: Startup pre-cache uses 8 parallel workers. New images detected by `fs.watch` are processed with a 500ms debounce.

---

## 11. PDF Generation

### Order PDF (`POST /api/pedido/pdf`)

- **Layout**: A4 portrait, 50px margins
- **Header**: Company name, "Resumen del Pedido", timestamp
- **Table**: Reference, Name, Quantity, Unit Price, Subtotal
- **Styling**: Dark header row with alternating zebra stripes, pink accent (#e91e63), automatic page breaks

### Catalog PDF (`POST /api/catalogo/pdf`)

- **Custom page size** based on single-column card layout (290px card width)
- **Cards**: Image (305px) + text area (58px) with reference, name, and price
- **Automatic layout**: Cards flow left-to-right, top-to-bottom; new pages are added as needed
- **Image embedding**: JPEGs from cache; aspect-ratio-aware cropping with `sharp`
- **Footer**: Generation date and copyright

### Combined Invoice PDF (`POST /api/vendedor/facturas`)

- **Input**: One or more DIAN-format PDF invoices (Colombia)
- **Extraction**: Uses `pdf-parse` to extract text, then regex-parses:
  - Document number (`Nro. Doc.`)
  - Customer name (`Razón social/Nombre`)
  - Line items (format: `Qty code 94 description value`)
- **Multiplier**: Each line item's unit price is multiplied by **2.5×**
- **Output**: Single consolidated PDF with per-invoice subtotals and a grand total

---

## 12. Getting Started

### Prerequisites

- Docker and Docker Compose installed
- (Optional) Product images organized in the folder structure described above

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/luxora-gems.git
cd luxora-gems

# Start the application
docker-compose up -d
```

### Access

| Interface | URL |
|-----------|-----|
| Public Catalog | `http://localhost:3000` |
| Admin Panel | `http://localhost:3000/admin/` |

### Default Credentials

| Role | Password |
|------|----------|
| Admin | `1234` |
| Vendor | `123` |
| User | `123` |

---

## 13. Administrator Guide

### Importing Products from Excel

1. Open the Admin Panel → **Excel** tab
2. Click the upload area and select a `.xlsx` file
3. The Excel must have: **Column A = Reference** | **Column B = Name** | **Column C = Price**
4. Row 1 is treated as a header and skipped
5. Only products with a matching image in `/imagenes/` are imported

### Managing Featured & New Products

**Option A — Toggle individually:**
- Go to the **Destacados** tab and toggle the star/tag icon next to each product

**Option B — Bulk import from Excel:**
- Upload a single-column Excel file (Column A = Reference)
- Row 1 is skipped (header)
- This **replaces** the entire list

### Cache Management

- **Refresh photos** (`🔄 Refrescar fotos`): Deletes the entire cache and regenerates WebP/JPEG versions of all images in the background
- **Eliminar sin imagen** (`🗑 Eliminar sin imagen`): Removes all products from `productos.json` that do not have a corresponding image file

### Manifests

1. Ensure the PDF files are placed in the `manifiestos/` directory
2. Upload an Excel with **Column A = Reference** | **Column B = PDF filename**
3. References not found in `productos.json` are ignored; duplicates are updated

### Stock Sync with Desktop App

1. Run `bd/main.go` or `bd/actualizador.py` on the machine with the local accounting system
2. Configure the server URL (e.g., `http://localhost:3000`) and API key
3. Select the `.dat` file from the accounting system's database folder
4. Click **ACTUALIZAR CANTIDAD** — matched references are pushed to `/api/existencias`

---

*Documentation generated for portfolio purposes. All company names and data references are fictional.*
