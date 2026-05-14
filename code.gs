/**
 * ระบบจัดการร้านค้าสหกรณ์โรงเรียน - Backend (Google Apps Script) v2.3
 * เวอร์ชั่น: 2.3 - เพิ่ม API สำหรับการจัดการผู้ใช้งาน (Admin) และปรับปรุงประสิทธิภาพการขาย
 * วันที่สร้าง: 2025
 */

// ===== การตั้งค่าระบบ =====
const CONFIG = {
  APP_NAME: "ระบบร้านค้าสหกรณ์โรงเรียน",
  APP_VERSION: "2.3",
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 ชั่วโมง
  ADMIN_USERS: {
    admin: "admin123",
    teacher: "teacher123"
  },
  USER_ROLES: {
    admin: {
      name: "ผู้ดูแลระบบ",
      permissions: ["all"]
    },
    teacher: {
      name: "ครูผู้ดูแล",
      permissions: ["view_reports", "manage_products", "manage_members", "process_sales"]
    }
  },
  SHARE_PRICE: 10, // ราคาต่อหุ้น (บาท)
  BARCODE_PREFIX: "SCH", // คำนำหน้าบาร์โค้ด
  DRIVE_FOLDER: "", // จะถูกตั้งค่าใน Config
  BARCODE_API: "https://barcode.tec-it.com/barcode.ashx", // API สำหรับสร้างบาร์โค้ด
  DEFAULT_PRODUCT_IMAGE: "https://lh5.googleusercontent.com/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlWnOuVka4MllM"
};

/**
 * ฟังก์ชันหลักสำหรับแสดงหน้าเว็บ และ API Routing
 * รองรับทั้ง Web Page (default) และ API calls (?fn=...)
 */
function doGet(e) {
  try {
    // ถ้าเป็น API call (?fn=...) ให้ route ไปที่ API handler
    if (e && e.parameter && e.parameter.fn) {
      return handleApiGet(e.parameter);
    }
    
    initializeSheets();
    
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle(CONFIG.APP_NAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
      
  } catch (error) {
    Logger.log('Error in doGet: ' + error.toString());
    return HtmlService.createHtmlOutput('เกิดข้อผิดพลาดในการโหลดระบบ: ' + error.toString());
  }
}

/**
 * จัดการ API GET requests ผ่าน Query String
 * ใช้สำหรับข้อมูลทั่วไป (CORS ปลอดภัย)
 * ?fn=getProducts&sessionId=xxx
 * ?fn=getConfig
 */
function handleApiGet(params) {
  try {
    const fn = params.fn;
    const sessionId = params.sessionId || null;
    let args = [];
    
    if (params.args) {
      try {
        args = JSON.parse(decodeURIComponent(params.args));
      } catch (e) {
        args = [params.args];
      }
    }
    
    // Route ไปยังฟังก์ชันที่เหมาะสม
    let result;
    switch (fn) {
      case 'login':
        result = login(args[0], args[1]);
        break;
      case 'logout':
        result = logout(sessionId);
        break;
      case 'validateSession':
        const user = validateSession(sessionId);
        result = user ? { success: true, user: user } : { success: false, message: 'Session invalid' };
        break;
      case 'getConfig':
        result = { success: true, config: getConfig() };
        break;
      case 'getProducts':
        result = getProducts(sessionId);
        break;
      case 'getMembers':
        result = getMembers(sessionId);
        break;
      case 'getUsers':
        result = getUsers(sessionId);
        break;
      case 'getRecentSales':
        result = getRecentSales(sessionId);
        break;
      case 'getSalesReport':
        result = getSalesReport(args[0], args[1], sessionId);
        break;
      case 'getProfitSharingReport':
        result = getProfitSharingReport(sessionId);
        break;
      case 'findProductByBarcode':
        result = findProductByBarcode(args[0], sessionId);
        break;
      case 'getProductImages':
        result = getProductImages(sessionId);
        break;
      default:
        result = { success: false, message: 'Unknown function: ' + fn };
    }
    
    return createJsonResponse(result);
    
  } catch (error) {
    Logger.log('Error in handleApiGet: ' + error.toString());
    return createJsonResponse({ success: false, message: 'API Error: ' + error.toString() });
  }
}

/**
 * จัดการ API POST requests
 * ใช้สำหรับข้อมูลใหญ่ (base64 image, processSale, etc.)
 */
function doPost(e) {
  try {
    let requestData;
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return createJsonResponse({ success: false, message: 'Invalid JSON body' });
    }
    
    const { action, data, sessionId } = requestData;
    const result = handleApiRequest(requestData);
    
    return createJsonResponse(result);
    
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return createJsonResponse({ success: false, message: 'POST Error: ' + error.toString() });
  }
}

/**
 * สร้าง JSON response พร้อม CORS headers
 */
function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * ฟังก์ชันสำหรับ include ไฟล์ CSS และ JavaScript
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (error) {
    Logger.log('Error including file ' + filename + ': ' + error.toString());
    return '';
  }
}

/**
 * สร้างและตั้งค่า Sheets ที่จำเป็นทั้งหมด
 */
function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const sheetNames = sheets.map(sheet => sheet.getName());

  try {
    // สร้าง sheet Config
    if (sheetNames.indexOf('Config') === -1) {
      const configSheet = ss.insertSheet('Config');
      configSheet.appendRow(['config_json']);
      configSheet.appendRow([JSON.stringify({
        app_name: CONFIG.APP_NAME,
        app_version: CONFIG.APP_VERSION,
        session_timeout: CONFIG.SESSION_TIMEOUT,
        share_price: CONFIG.SHARE_PRICE,
        barcode_prefix: CONFIG.BARCODE_PREFIX,
        drive_folder_id: '',
        notification_enabled: true,
        maintenance_mode: false,
        auto_backup: true,
        backup_frequency: 'daily',
        currency: 'THB',
        tax_rate: 0,
        receipt_footer: 'ขอบคุณที่ใช้บริการร้านค้าสหกรณ์',
        promptpay_number: '0891234567',
        promptpay_name: 'ร้านค้าสหกรณ์โรงเรียน',
        promptpay_qr_url: '', // เพิ่มฟิลด์สำหรับ QR Code URL
        bank_account: '1234567890',
        bank_name: 'ธนาคารกรุงไทย',
        enable_cash_change: true,
        default_product_image: CONFIG.DEFAULT_PRODUCT_IMAGE,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })]);
    }

    // สร้าง sheet Users
    if (sheetNames.indexOf('Users') === -1) {
      const usersSheet = ss.insertSheet('Users');
      usersSheet.appendRow(['user_json']);
      
      Object.keys(CONFIG.ADMIN_USERS).forEach(username => {
        const userData = {
          id: Utilities.getUuid(),
          username: username,
          password: CONFIG.ADMIN_USERS[username],
          role: username,
          name: CONFIG.USER_ROLES[username].name,
          permissions: CONFIG.USER_ROLES[username].permissions,
          active: true,
          last_login: '',
          login_attempts: 0,
          locked_until: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        usersSheet.appendRow([JSON.stringify(userData)]);
      });
    }

    // สร้าง sheets อื่นๆ
    const requiredSheets = ['Products', 'Members', 'Sales', 'SaleItems', 'Sessions', 'Logs'];
    requiredSheets.forEach(sheetName => {
      if (sheetNames.indexOf(sheetName) === -1) {
        const sheet = ss.insertSheet(sheetName);
        const columnName = sheetName.toLowerCase().slice(0, -1) + '_json';
        if (sheetName === 'SaleItems') {
          sheet.appendRow(['sale_item_json']);
        } else {
          sheet.appendRow([columnName]);
        }
      }
    });

    Logger.log('All sheets initialized successfully');
    return { status: 'success', message: 'สร้าง sheets ทั้งหมดเรียบร้อยแล้ว' };

  } catch (error) {
    Logger.log('Error in initializeSheets: ' + error.toString());
    return { status: 'error', message: error.toString() };
  }
}

// ===== Authentication & Session Management =====

function login(username, password) {
  try {
    const user = getUserByCredentials(username, password);
    
    if (!user) {
      logActivity('login_failed', { username: username, ip: Session.getTemporaryActiveUserKey() });
      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    if (!user.active) {
      return { success: false, message: 'บัญชีผู้ใช้ถูกระงับ' };
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return { success: false, message: 'บัญชีถูกล็อก กรุณาลองใหม่อีกครั้งในภายหลัง' };
    }

    const sessionId = Utilities.getUuid();
    const expiresAt = new Date(Date.now() + CONFIG.SESSION_TIMEOUT).toISOString();
    
    const sessionData = {
      id: sessionId,
      user_id: user.id,
      username: user.username,
      role: user.role,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString()
    };

    const sessionsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sessions');
    sessionsSheet.appendRow([JSON.stringify(sessionData)]);

    updateUserLastLogin(user.id);
    logActivity('login_success', { user_id: user.id, username: user.username });

    return {
      success: true,
      sessionId: sessionId,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        permissions: user.permissions
      }
    };

  } catch (error) {
    Logger.log('Error in login: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการล็อกอิน' };
  }
}

function validateSession(sessionId) {
  try {
    if (!sessionId) return null;

    const sessionsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sessions');
    const data = sessionsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const session = JSON.parse(data[i][0]);
      
      if (session.id === sessionId) {
        if (new Date(session.expires_at) < new Date()) {
          return null;
        }

        session.last_activity = new Date().toISOString();
        sessionsSheet.getRange(i + 1, 1).setValue(JSON.stringify(session));

        const user = getUserById(session.user_id);
        return user;
      }
    }

    return null;
  } catch (error) {
    Logger.log('Error in validateSession: ' + error.toString());
    return null;
  }
}

function logout(sessionId) {
  try {
    if (!sessionId) return { success: false, message: 'ไม่พบ session' };

    const sessionsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sessions');
    const data = sessionsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const session = JSON.parse(data[i][0]);
      
      if (session.id === sessionId) {
        sessionsSheet.deleteRow(i + 1);
        logActivity('logout', { user_id: session.user_id, username: session.username });
        return { success: true, message: 'ล็อกเอาท์เรียบร้อย' };
      }
    }

    return { success: false, message: 'ไม่พบ session' };
  } catch (error) {
    Logger.log('Error in logout: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการล็อกเอาท์' };
  }
}

// ===== User Management (Helpers) =====

function getUserByCredentials(username, password) {
  try {
    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const user = JSON.parse(data[i][0]);
      if (user.username === username && user.password === password) {
        return user;
      }
    }
    
    return null;
  } catch (error) {
    Logger.log('Error in getUserByCredentials: ' + error.toString());
    return null;
  }
}

function getUserById(userId) {
  try {
    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const user = JSON.parse(data[i][0]);
      if (user.id === userId) {
        return user;
      }
    }
    
    return null;
  } catch (error) {
    Logger.log('Error in getUserById: ' + error.toString());
    return null;
  }
}

function updateUserLastLogin(userId) {
  try {
    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const user = JSON.parse(data[i][0]);
      if (user.id === userId) {
        user.last_login = new Date().toISOString();
        user.login_attempts = 0;
        user.locked_until = null;
        usersSheet.getRange(i + 1, 1).setValue(JSON.stringify(user));
        break;
      }
    }
  } catch (error) {
    Logger.log('Error in updateUserLastLogin: ' + error.toString());
  }
}

/**
 * *** NEW: Helper function to find user by username ***
 */
function getUserByUsername(username) {
  try {
    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const user = JSON.parse(data[i][0]);
      if (user.username === username) {
        return user; // Found
      }
    }
    return null; // Not found
  } catch (error) {
    Logger.log('Error in getUserByUsername: ' + error.toString());
    return null;
  }
}

// ===== File Upload Management =====

/**
 * จัดการการอัพโหลดไฟล์ - ใช้ URL แบบสั้น (รองรับ QR Code)
 */
function handleFileUpload(fileData) {
  try {
    // ตรวจสอบขนาดไฟล์ (จำกัดที่ 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (fileData.content.length > maxSize) {
      return { success: false, message: 'ไฟล์มีขนาดใหญ่เกิน 5MB' };
    }

    // ตรวจสอบประเภทไฟล์
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(fileData.mimeType)) {
      return { success: false, message: 'ประเภทไฟล์ไม่รองรับ กรุณาใช้ JPG, PNG, GIF หรือ WebP' };
    }

    // สร้างโฟลเดอร์สำหรับเก็บรูปภาพถ้ายังไม่มี
    let folderId = getOrCreateImageFolder();
    
    // แปลง Base64 เป็น Blob
    const base64Data = fileData.content.split(',')[1]; // ลบ data:image/...;base64,
    const binaryData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(binaryData, fileData.mimeType, fileData.name);

    // อัพโหลดไฟล์ไป Google Drive
    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(blob);
    
    // ตั้งค่าให้ทุกคนเข้าถึงได้
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // ✅ สร้าง URL แบบสั้น (ดีกว่า)
    const imageUrl = 'https://lh5.googleusercontent.com/d/' + file.getId();
    
    // บันทึกข้อมูลไฟล์
    logActivity('upload_file', { 
      file_id: file.getId(),
      file_name: fileData.name,
      file_size: binaryData.length,
      mime_type: fileData.mimeType,
      image_url: imageUrl
    });

    return {
      success: true,
      imageUrl: imageUrl,
      fileId: file.getId(),
      fileName: fileData.name,
      message: 'อัพโหลดรูปภาพเรียบร้อย'
    };

  } catch (error) {
    Logger.log('Error in handleFileUpload: ' + error.toString());
    return { 
      success: false, 
      message: 'เกิดข้อผิดพลาดในการอัพโหลดไฟล์: ' + error.toString() 
    };
  }
}

/**
 * สร้างหรือค้นหาโฟลเดอร์สำหรับเก็บรูปภาพ
 */
function getOrCreateImageFolder() {
  try {
    // ตรวจสอบการตั้งค่าโฟลเดอร์จาก config
    const config = getConfig();
    
    if (config.drive_folder_id) {
      // ตรวจสอบว่าโฟลเดอร์ยังมีอยู่หรือไม่
      try {
        const folder = DriveApp.getFolderById(config.drive_folder_id);
        return config.drive_folder_id;
      } catch (e) {
        // โฟลเดอร์ไม่พบ สร้างใหม่
        Logger.log('Existing folder not found, creating new one');
      }
    }

    // สร้างโฟลเดอร์ใหม่
    const folderName = 'SchoolCoop_Images_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    const folder = DriveApp.createFolder(folderName);
    
    // อัพเดท config
    const updatedConfig = {
      ...config,
      drive_folder_id: folder.getId(),
      updated_at: new Date().toISOString()
    };
    
    const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
    configSheet.getRange(2, 1).setValue(JSON.stringify(updatedConfig));
    
    Logger.log('Created new image folder: ' + folder.getName() + ' (' + folder.getId() + ')');
    return folder.getId();

  } catch (error) {
    Logger.log('Error in getOrCreateImageFolder: ' + error.toString());
    throw new Error('ไม่สามารถสร้างโฟลเดอร์สำหรับเก็บรูปภาพได้');
  }
}

/**
 * ลบไฟล์รูปภาพ
 */
function deleteProductImage(fileId) {
  try {
    if (!fileId) return { success: true, message: 'ไม่มีไฟล์ต้องลบ' };
    
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    
    return { success: true, message: 'ลบรูปภาพเรียบร้อย' };
    
  } catch (error) {
    Logger.log('Error in deleteProductImage: ' + error.toString());
    return { success: false, message: 'ไม่สามารถลบรูปภาพได้' };
  }
}

/**
 * รับรายชื่อไฟล์รูปภาพทั้งหมด - ใช้ URL แบบสั้น
 */
function getProductImages(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const config = getConfig();
    if (!config.drive_folder_id) {
      return { success: true, images: [] };
    }

    const folder = DriveApp.getFolderById(config.drive_folder_id);
    const files = folder.getFiles();
    const images = [];

    while (files.hasNext()) {
      const file = files.next();
      if (file.getBlob().getContentType().startsWith('image/')) {
        images.push({
          id: file.getId(),
          name: file.getName(),
          url: 'https://lh5.googleusercontent.com/d/' + file.getId(), // ✅ URL แบบสั้น
          size: file.getSize(),
          created: file.getDateCreated()
        });
      }
    }

    return { success: true, images: images };

  } catch (error) {
    Logger.log('Error in getProductImages: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการรูปภาพ' };
  }
}

// ===== Product Management =====

function addProduct(productData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_products')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการเพิ่มสินค้า' };
    }

    const barcode = productData.barcode || generateBarcode();
    
    const product = {
      id: Utilities.getUuid(),
      barcode: barcode,
      name: productData.name,
      description: productData.description || '',
      category: productData.category || 'อื่นๆ',
      price: parseFloat(productData.price),
      cost: parseFloat(productData.cost) || 0,
      stock: parseInt(productData.stock) || 0,
      min_stock: parseInt(productData.min_stock) || 5,
      unit: productData.unit || 'ชิ้น',
      image_url: productData.image_url || getConfig().default_product_image,
      barcode_image_url: generateBarcodeImageUrl(barcode),
      active: true,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    productsSheet.appendRow([JSON.stringify(product)]);

    logActivity('add_product', { 
      product_id: product.id, 
      product_name: product.name,
      user_id: user.id 
    });

    return { 
      success: true, 
      message: 'เพิ่มสินค้าเรียบร้อย',
      product: product
    };

  } catch (error) {
    Logger.log('Error in addProduct: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มสินค้า' };
  }
}

function updateProduct(productData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_products')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการแก้ไขสินค้า' };
    }

    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    const data = productsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const product = JSON.parse(data[i][0]);
      if (product.id === productData.id) {
        product.name = productData.name;
        product.description = productData.description || '';
        product.category = productData.category || 'อื่นๆ';
        product.price = parseFloat(productData.price);
        product.cost = parseFloat(productData.cost) || 0;
        product.stock = parseInt(productData.stock) || 0;
        product.min_stock = parseInt(productData.min_stock) || 5;
        product.unit = productData.unit || 'ชิ้น';
        product.image_url = productData.image_url || product.image_url;
        product.updated_at = new Date().toISOString();
        
        if (productData.barcode && productData.barcode !== product.barcode) {
          product.barcode = productData.barcode;
          product.barcode_image_url = generateBarcodeImageUrl(productData.barcode);
        }
        
        productsSheet.getRange(i + 1, 1).setValue(JSON.stringify(product));
        
        logActivity('update_product', { 
          product_id: product.id, 
          product_name: product.name,
          user_id: user.id 
        });
        
        return { success: true, message: 'แก้ไขสินค้าเรียบร้อย', product: product };
      }
    }

    return { success: false, message: 'ไม่พบสินค้า' };

  } catch (error) {
    Logger.log('Error in updateProduct: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขสินค้า' };
  }
}

function deleteProduct(productId, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_products')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการลบสินค้า' };
    }

    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    const data = productsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const product = JSON.parse(data[i][0]);
      if (product.id === productId) {
        // *** ลบแถวจริง ๆ (Hard Delete) ***
        productsSheet.deleteRow(i + 1);
        
        logActivity('delete_product', { 
          product_id: product.id, 
          product_name: product.name,
          user_id: user.id 
        });
        
        return { success: true, message: 'ลบสินค้าเรียบร้อย' };
      }
    }

    return { success: false, message: 'ไม่พบสินค้า' };

  } catch (error) {
    Logger.log('Error in deleteProduct: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการลบสินค้า' };
  }
}

function getProducts(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    const data = productsSheet.getDataRange().getValues();
    
    const products = [];
    for (let i = 1; i < data.length; i++) {
      const product = JSON.parse(data[i][0]);
      if (product.active) {
        products.push(product);
      }
    }

    products.sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, products: products };

  } catch (error) {
    Logger.log('Error in getProducts: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสินค้า' };
  }
}

function findProductByBarcode(barcode, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    const data = productsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const product = JSON.parse(data[i][0]);
      if (product.barcode === barcode && product.active) {
        return { success: true, product: product };
      }
    }

    return { success: false, message: 'ไม่พบสินค้า' };

  } catch (error) {
    Logger.log('Error in findProductByBarcode: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการค้นหาสินค้า' };
  }
}

/**
 * Helper function to get all product data including row index for optimized stock update
 */
function getAllProductsWithIndex() {
  const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  const data = productsSheet.getDataRange().getValues();
  const productMap = {};
  
  for (let i = 1; i < data.length; i++) {
    const product = JSON.parse(data[i][0]);
    // Store product info and its row index (i+1 is the actual row number)
    productMap[product.id] = { product: product, row: i + 1 };
  }
  return productMap;
}

/**
 * Optimized function to update product stock in batch
 * @param {Array<{id: string, newStock: number, originalData: object}>} updates - Array of stock updates
 */
function updateProductStockBatch(updates) {
  if (updates.length === 0) return;

  const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  const rangeToUpdate = productsSheet.getRange(updates[0].row, 1, updates.length, 1);
  const values = [];

  for (const update of updates) {
    const product = update.originalData;
    product.stock = update.newStock;
    product.updated_at = new Date().toISOString();
    values.push([JSON.stringify(product)]);
  }

  rangeToUpdate.setValues(values);
  Logger.log(`Updated stock for ${updates.length} products.`);
}


function generateBarcode() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return CONFIG.BARCODE_PREFIX + timestamp + random;
}

function generateBarcodeImageUrl(barcode) {
  return `${CONFIG.BARCODE_API}?data=${barcode}&code=Code128&multiplebarcodes=false&translate-esc=false&unit=Fit&dpi=96&imagetype=Gif&rotation=0&color=%23000000&bgcolor=%23ffffff&qunit=Mm&quiet=0`;
}

// ===== Member Management =====

function addMember(memberData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_members')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการเพิ่มสมาชิก' };
    }

    const existingMember = getMemberByStudentId(memberData.student_id);
    if (existingMember) {
      return { success: false, message: 'รหัสนักเรียนนี้เป็นสมาชิกอยู่แล้ว' };
    }

    const shares = parseInt(memberData.shares) || 1;
    const sharePrice = getConfig().share_price || CONFIG.SHARE_PRICE;
    const totalAmount = shares * sharePrice;

    const member = {
      id: Utilities.getUuid(),
      student_id: memberData.student_id,
      firstname: memberData.firstname,
      lastname: memberData.lastname,
      classroom: memberData.classroom,
      grade: memberData.grade || '',
      shares: shares,
      share_price: sharePrice,
      total_amount: totalAmount,
      join_date: new Date().toISOString(),
      status: 'active',
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    membersSheet.appendRow([JSON.stringify(member)]);

    logActivity('add_member', { 
      member_id: member.id, 
      student_id: member.student_id,
      name: `${member.firstname} ${member.lastname}`,
      user_id: user.id 
    });

    return { 
      success: true, 
      message: 'เพิ่มสมาชิกเรียบร้อย',
      member: member
    };

  } catch (error) {
    Logger.log('Error in addMember: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มสมาชิก' };
  }
}

function updateMember(memberData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_members')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการแก้ไขสมาชิก' };
    }

    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    const data = membersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const member = JSON.parse(data[i][0]);
      if (member.id === memberData.id) {
        const shares = parseInt(memberData.shares) || 1;
        const sharePrice = getConfig().share_price || CONFIG.SHARE_PRICE;
        
        member.student_id = memberData.student_id;
        member.firstname = memberData.firstname;
        member.lastname = memberData.lastname;
        member.classroom = memberData.classroom;
        member.grade = memberData.grade || '';
        member.shares = shares;
        member.share_price = sharePrice;
        member.total_amount = shares * sharePrice;
        member.updated_at = new Date().toISOString();
        
        membersSheet.getRange(i + 1, 1).setValue(JSON.stringify(member));
        
        logActivity('update_member', { 
          member_id: member.id, 
          student_id: member.student_id,
          name: `${member.firstname} ${member.lastname}`,
          user_id: user.id 
        });
        
        return { success: true, message: 'แก้ไขสมาชิกเรียบร้อย', member: member };
      }
    }

    return { success: false, message: 'ไม่พบสมาชิก' };

  } catch (error) {
    Logger.log('Error in updateMember: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขสมาชิก' };
  }
}

function deleteMember(memberId, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('manage_members')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการลบสมาชิก' };
    }

    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    const data = membersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const member = JSON.parse(data[i][0]);
      if (member.id === memberId) {
        // *** ลบแถวจริง ๆ (Hard Delete) ***
        membersSheet.deleteRow(i + 1);
        
        logActivity('delete_member', { 
          member_id: member.id, 
          student_id: member.student_id,
          name: `${member.firstname} ${member.lastname}`,
          user_id: user.id 
        });
        
        return { success: true, message: 'ลบสมาชิกเรียบร้อย' };
      }
    }

    return { success: false, message: 'ไม่พบสมาชิก' };

  } catch (error) {
    Logger.log('Error in deleteMember: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการลบสมาชิก' };
  }
}

function getMembers(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    const data = membersSheet.getDataRange().getValues();
    
    const members = [];
    for (let i = 1; i < data.length; i++) {
      const member = JSON.parse(data[i][0]);
      if (member.status === 'active') {
        members.push(member);
      }
    }

    members.sort((a, b) => `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`));

    return { success: true, members: members };

  } catch (error) {
    Logger.log('Error in getMembers: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสมาชิก' };
  }
}

function getMemberByStudentId(studentId) {
  try {
    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    const data = membersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const member = JSON.parse(data[i][0]);
      if (member.student_id === studentId && member.status === 'active') {
        return member;
      }
    }
    
    return null;
  } catch (error) {
    Logger.log('Error in getMemberByStudentId: ' + error.toString());
    return null;
  }
}


// ===== *** NEW: User Management (Admin Only) *** =====

/**
 * *** NEW: Get all users (Admin) ***
 */
function getUsers(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user || user.role !== 'admin') {
      return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
    }

    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    const users = [];

    for (let i = 1; i < data.length; i++) {
      const u = JSON.parse(data[i][0]);
      // Do not send password to frontend
      delete u.password; 
      users.push(u);
    }

    users.sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, users: users };

  } catch (error) {
    Logger.log('Error in getUsers: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้' };
  }
}

/**
 * *** NEW: Add a new user (Admin) ***
 */
function addUser(userData, sessionId) {
  try {
    const adminUser = validateSession(sessionId);
    if (!adminUser || adminUser.role !== 'admin') {
      return { success: false, message: 'ไม่มีสิทธิ์เพิ่มผู้ใช้' };
    }

    if (!userData.username || !userData.password || !userData.role) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
    }

    if (getUserByUsername(userData.username)) {
      return { success: false, message: 'ชื่อผู้ใช้นี้ (username) ถูกใช้แล้ว' };
    }
    
    const newUser = {
      id: Utilities.getUuid(),
      username: userData.username,
      password: userData.password,
      name: userData.name || userData.username,
      role: userData.role, // 'admin' or 'teacher'
      permissions: CONFIG.USER_ROLES[userData.role] ? CONFIG.USER_ROLES[userData.role].permissions : [],
      active: true,
      last_login: null,
      login_attempts: 0,
      locked_until: null,
      created_by: adminUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    usersSheet.appendRow([JSON.stringify(newUser)]);

    logActivity('add_user', { new_user_id: newUser.id, username: newUser.username, by_user_id: adminUser.id });
    return { success: true, message: 'เพิ่มผู้ใช้งานเรียบร้อย' };

  } catch (error) {
    Logger.log('Error in addUser: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มผู้ใช้' };
  }
}

/**
 * *** NEW: Update an existing user (Admin) ***
 */
function updateUser(userData, sessionId) {
  try {
    const adminUser = validateSession(sessionId);
    if (!adminUser || adminUser.role !== 'admin') {
      return { success: false, message: 'ไม่มีสิทธิ์แก้ไขผู้ใช้' };
    }
    
    if (adminUser.id === userData.id && !userData.active) {
       return { success: false, message: 'คุณไม่สามารถปิดใช้งานบัญชีของตัวเองได้' };
    }

    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const user = JSON.parse(data[i][0]);
      if (user.id === userData.id) {
        user.name = userData.name || user.name;
        user.role = userData.role || user.role;
        user.permissions = CONFIG.USER_ROLES[user.role] ? CONFIG.USER_ROLES[user.role].permissions : [];
        user.active = userData.active; // This will be true/false
        
        // Only update password if a new one is provided
        if (userData.password && userData.password.length > 0) {
          user.password = userData.password;
        }
        
        user.updated_at = new Date().toISOString();
        
        usersSheet.getRange(i + 1, 1).setValue(JSON.stringify(user));
        
        logActivity('update_user', { user_id: user.id, username: user.username, by_user_id: adminUser.id });
        return { success: true, message: 'แก้ไขผู้ใช้งานเรียบร้อย' };
      }
    }

    return { success: false, message: 'ไม่พบผู้ใช้งาน' };

  } catch (error) {
    Logger.log('Error in updateUser: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขผู้ใช้' };
  }
}

/**
 * *** NEW: Delete a user (Soft Delete) (Admin) ***
 */
function deleteUser(data, sessionId) {
  try {
    const adminUser = validateSession(sessionId);
    if (!adminUser || adminUser.role !== 'admin') {
      return { success: false, message: 'ไม่มีสิทธิ์ลบผู้ใช้' };
    }
    
    const userIdToDelete = data.id;
    if (adminUser.id === userIdToDelete) {
      return { success: false, message: 'คุณไม่สามารถลบตัวเองได้' };
    }

    const usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const sheetData = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < sheetData.length; i++) {
      const user = JSON.parse(sheetData[i][0]);
      if (user.id === userIdToDelete) {
        // *** ลบแถวจริง ๆ (Hard Delete) ***
        usersSheet.deleteRow(i + 1);
        
        logActivity('delete_user', { user_id: user.id, username: user.username, by_user_id: adminUser.id });
        return { success: true, message: 'ลบผู้ใช้งานเรียบร้อย' };
      }
    }

    return { success: false, message: 'ไม่พบผู้ใช้งาน' };

  } catch (error) {
    Logger.log('Error in deleteUser: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการลบผู้ใช้' };
  }
}


// ===== Sales Management (Optimized) =====

function processSale(saleData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('process_sales')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการบันทึกขาย' };
    }

    const productsMap = getAllProductsWithIndex();
    
    const productsToUpdate = [];
    let totalAmount = 0;
    const items = saleData.items || [];
    
    for (const item of items) {
      const productEntry = productsMap[item.product_id];
      if (!productEntry) {
        return { success: false, message: `ไม่พบสินค้า ID: ${item.product_id}` };
      }
      
      const product = productEntry.product;
      const newStock = product.stock - item.quantity;

      if (newStock < 0) {
        return { success: false, message: `สินค้า ${product.name} มีสต็อกไม่เพียงพอ (เหลือ ${product.stock} ${product.unit})` };
      }
      
      totalAmount += product.price * item.quantity;
      
      // Stage the stock update
      productsToUpdate.push({
        id: product.id,
        newStock: newStock,
        originalData: product,
        row: productEntry.row // Row index in the sheet
      });
    }

    // 1. บันทึกข้อมูลการขายหลัก
    const saleId = Utilities.getUuid();
    const saleDate = new Date().toISOString();
    
    const sale = {
      id: saleId,
      member_id: saleData.member_id || null,
      total_amount: totalAmount,
      discount: parseFloat(saleData.discount) || 0,
      final_amount: totalAmount - (parseFloat(saleData.discount) || 0),
      payment_method: saleData.payment_method || 'cash',
      received_amount: parseFloat(saleData.received_amount) || 0,
      change_amount: parseFloat(saleData.change_amount) || 0,
      sale_date: saleDate,
      cashier_id: user.id,
      notes: saleData.notes || '',
      created_at: saleDate
    };

    const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales');
    salesSheet.appendRow([JSON.stringify(sale)]);

    const saleItemsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SaleItems');
    
    for (const item of items) {
      const product = productsMap[item.product_id].product;
      
      const saleItem = {
        id: Utilities.getUuid(),
        sale_id: saleId,
        product_id: item.product_id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: product.price,
        total_price: product.price * item.quantity,
        created_at: saleDate
      };
      
      saleItemsSheet.appendRow([JSON.stringify(saleItem)]);
    }

    // 2. อัปเดตสต็อกสินค้า (Batch Update)
    // ต้องจัดเรียง productsToUpdate ตาม Row Index ก่อนทำ Batch Update
    productsToUpdate.sort((a, b) => a.row - b.row);
    updateProductStockBatch(productsToUpdate);

    logActivity('process_sale', { 
      sale_id: saleId, 
      total_amount: sale.final_amount,
      items_count: items.length,
      user_id: user.id 
    });

    return { 
      success: true, 
      message: 'บันทึกการขายเรียบร้อย',
      sale_id: saleId,
      receipt_number: saleId.slice(-8).toUpperCase()
    };

  } catch (error) {
    Logger.log('Error in processSale: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการบันทึกขาย: ' + error.toString() };
  }
}


function getProductById(productId) {
  try {
    const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
    const data = productsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const product = JSON.parse(data[i][0]);
      if (product.id === productId) {
        return product;
      }
    }
    
    return null;
  } catch (error) {
    Logger.log('Error in getProductById: ' + error.toString());
    return null;
  }
}

// ===== Configuration Management - เพิ่มการรองรับ QR Code URL =====

function getConfig() {
  try {
    const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
    const data = configSheet.getDataRange().getValues();
    
    if (data.length > 1) {
      return JSON.parse(data[1][0]);
    }
    
    return {};
  } catch (error) {
    Logger.log('Error in getConfig: ' + error.toString());
    return {};
  }
}

function updateConfig(configData, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการแก้ไขการตั้งค่า' };
    }

    const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
    const currentConfig = getConfig();
    
    // อัพเดทการตั้งค่า
    const updatedConfig = {
      ...currentConfig,
      ...configData,
      updated_at: new Date().toISOString()
    };

    configSheet.getRange(2, 1).setValue(JSON.stringify(updatedConfig));
    
    logActivity('update_config', { 
      updated_fields: Object.keys(configData),
      user_id: user.id 
    });

    return { success: true, message: 'อัพเดทการตั้งค่าเรียบร้อย', config: updatedConfig };

  } catch (error) {
    Logger.log('Error in updateConfig: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการอัพเดทการตั้งค่า' };
  }
}

// ===== Reports =====

function getRecentSales(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales');
    const data = salesSheet.getDataRange().getValues(); // Get all data
    
    // Skip header row and process data
    const sales = [];
    for (let i = 1; i < data.length; i++) {
      const sale = JSON.parse(data[i][0]);
      sales.push(sale);
    }
    
    // Sort by sale_date descending
    sales.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());
    
    // Get top 5 recent sales
    const recentSales = sales.slice(0, 5).map(sale => {
      // Find items associated with this sale to get item count/names (simplified approach)
      // Note: For a detailed view, getSaleItems API might be better, but this is fast for dashboard.
      const saleItemsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SaleItems');
      const itemData = saleItemsSheet.getDataRange().getValues();
      let itemCount = 0;
      let firstItemName = 'สินค้า';
      
      for (let i = 1; i < itemData.length; i++) {
        const saleItem = JSON.parse(itemData[i][0]);
        if (saleItem.sale_id === sale.id) {
          itemCount += saleItem.quantity;
          if (firstItemName === 'สินค้า') {
            firstItemName = saleItem.product_name;
          }
        }
      }
      
      // Determine customer type (simplified)
      const customerType = sale.member_id ? 'สมาชิก' : 'ลูกค้าทั่วไป';
      
      return {
        id: sale.id,
        time: new Date(sale.sale_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        item: firstItemName + (itemCount > 1 ? ` (+${itemCount - 1} อื่นๆ)` : ''), // Show main item and count
        amount: sale.final_amount,
        customer: customerType
      };
    });
    
    return { success: true, recentSales: recentSales };

  } catch (error) {
    Logger.log('Error in getRecentSales: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการขายล่าสุด' };
  }
}

function getSalesReport(period, date, sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    if (!user.permissions.includes('all') && !user.permissions.includes('view_reports')) {
      return { success: false, message: 'ไม่มีสิทธิ์ในการดูรายงาน' };
    }

    const salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales');
    const saleItemsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SaleItems');
    const membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');

    const targetDate = new Date(date);
    let startDate, endDate;

    switch (period) {
      case 'daily':
        startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        endDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
        break;
      case 'weekly':
        const dayOfWeek = targetDate.getDay();
        startDate = new Date(targetDate.getTime() - (dayOfWeek * 24 * 60 * 60 * 1000));
        startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        endDate = new Date(startDate.getTime() + (7 * 24 * 60 * 60 * 1000));
        break;
      case 'monthly':
        startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
        endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
        break;
      default:
        return { success: false, message: 'ระบุช่วงเวลาไม่ถูกต้อง' };
    }

    const salesData = salesSheet.getDataRange().getValues();
    const saleItemsData = saleItemsSheet.getDataRange().getValues();
    const membersData = membersSheet.getDataRange().getValues();

    let totalSales = 0;
    let totalTransactions = 0;
    const productSales = {};
    const dailySales = {};

    for (let i = 1; i < salesData.length; i++) {
      const sale = JSON.parse(salesData[i][0]);
      const saleDate = new Date(sale.sale_date);

      if (saleDate >= startDate && saleDate < endDate) {
        totalSales += sale.final_amount;
        totalTransactions++;

        const dayKey = saleDate.toISOString().split('T')[0];
        if (!dailySales[dayKey]) {
          dailySales[dayKey] = { amount: 0, transactions: 0 };
        }
        dailySales[dayKey].amount += sale.final_amount;
        dailySales[dayKey].transactions++;
      }
    }

    for (let i = 1; i < saleItemsData.length; i++) {
      const saleItem = JSON.parse(saleItemsData[i][0]);
      const saleDate = new Date(saleItem.created_at);

      if (saleDate >= startDate && saleDate < endDate) {
        if (!productSales[saleItem.product_name]) {
          productSales[saleItem.product_name] = {
            name: saleItem.product_name,
            quantity: 0,
            revenue: 0
          };
        }
        productSales[saleItem.product_name].quantity += saleItem.quantity;
        productSales[saleItem.product_name].revenue += saleItem.total_price;
      }
    }

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    let activeMembersCount = 0;
    for (let i = 1; i < membersData.length; i++) {
      const member = JSON.parse(membersData[i][0]);
      if (member.status === 'active') {
        activeMembersCount++;
      }
    }

    const chartData = Object.keys(dailySales).map(date => ({
      date: date,
      amount: dailySales[date].amount,
      transactions: dailySales[date].transactions
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      success: true,
      report: {
        period: period,
        date_range: {
          start: startDate.toISOString().split('T')[0],
          end: new Date(endDate.getTime() - 1).toISOString().split('T')[0]
        },
        summary: {
          total_sales: totalSales,
          total_transactions: totalTransactions,
          average_transaction: totalTransactions > 0 ? totalSales / totalTransactions : 0,
          active_members: activeMembersCount
        },
        top_products: topProducts,
        daily_sales: chartData
      }
    };

  } catch (error) {
    Logger.log('Error in getSalesReport: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการสร้างรายงาน' };
  }
}

function logActivity(action, data = {}) {
  try {
    const logsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Logs');
    
    const logEntry = {
      id: Utilities.getUuid(),
      action: action,
      data: data,
      timestamp: new Date().toISOString(),
      ip: Session.getTemporaryActiveUserKey() || 'unknown'
    };
    
    logsSheet.appendRow([JSON.stringify(logEntry)]);
    
  } catch (error) {
    Logger.log('Error in logActivity: ' + error.toString());
  }
}

// ===== API Endpoints =====


function getProfitSharingReport(sessionId) {
  try {
    const user = validateSession(sessionId);
    if (!user) return { success: false, message: 'กรุณาล็อกอินใหม่' };

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // ดึงข้อมูลสมาชิก
    const membersSheet = spreadsheet.getSheetByName('Members');
    const membersData = membersSheet.getDataRange().getValues();
    
    const members = [];
    let totalShares = 0;
    
    for (let i = 1; i < membersData.length; i++) {
      try {
        const member = JSON.parse(membersData[i][0]);
        if (member && member.status === 'active') {
          members.push(member);
          totalShares += parseInt(member.shares || 0);
        }
      } catch(e) {
        // Skip invalid entries
      }
    }

    // ดึงข้อมูลการขาย
    const salesSheet = spreadsheet.getSheetByName('Sales');
    const salesData = salesSheet.getDataRange().getValues();
    
    let totalSales = 0;
    let totalCost = 0;
    
    for (let i = 1; i < salesData.length; i++) {
      try {
        const sale = JSON.parse(salesData[i][0]);
        if (sale && sale.status !== 'cancelled') {
          totalSales += parseFloat(sale.final_amount || sale.total_amount || 0);
          
          // คำนวณต้นทุนจากสินค้า
          if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(function(item) {
              const cost = parseFloat(item.cost || item.price || 0);
              const qty = parseInt(item.quantity || 0);
              totalCost += cost * qty;
            });
          } else {
            // ถ้าไม่มี items detail ให้คิดต้นทุน 60% ของยอดขาย
            totalCost += parseFloat(sale.final_amount || sale.total_amount || 0) * 0.6;
          }
        }
      } catch(e) {
        // Skip invalid entries
      }
    }

    // คำนวณกำไร
    const profit = totalSales - totalCost;
    const operatingCost = Math.max(0, profit * 0.1); // หัก 10%
    const netProfit = Math.max(0, profit - operatingCost);
    
    // ปันผลต่อหุ้น
    const dividendPerShare = totalShares > 0 ? netProfit / totalShares : 0;
    
    // คำนวณปันผลของแต่ละสมาชิก
    const memberDividends = members.map(function(member) {
      return {
        id: member.id,
        student_id: member.student_id,
        firstname: member.firstname,
        lastname: member.lastname,
        shares: member.shares,
        dividend: member.shares * dividendPerShare
      };
    });

    return {
      success: true,
      summary: {
        totalSales: totalSales,
        totalCost: totalCost,
        profit: profit,
        operatingCost: operatingCost,
        netProfit: netProfit,
        totalShares: totalShares,
        memberCount: members.length,
        dividendPerShare: dividendPerShare
      },
      members: memberDividends
    };

  } catch (error) {
    Logger.log('Error in getProfitSharingReport: ' + error.toString());
    return { success: false, message: 'เกิดข้อผิดพลาดในการคำนวณปันผล: ' + error.toString() };
  }
}

function handleApiRequest(request) {
  try {
    const { action, data, sessionId } = request;
    
    switch (action) {
      // Authentication
      case 'login':
        return login(data.username, data.password);
      case 'logout':
        return logout(sessionId);
      case 'validateSession':
        const user = validateSession(sessionId);
        return user ? { success: true, user: user } : { success: false, message: 'Session invalid' };
      
      // Configuration
      case 'getConfig':
        return { success: true, config: getConfig() };
      case 'updateConfig':
        return updateConfig(data, sessionId);
      case 'createImageFolder':
        return createImageFolder(sessionId); // NEW API
      
      // File upload & Images
      case 'uploadFile':
        return handleFileUpload(data);
      case 'getProductImages':
        return getProductImages(sessionId);
      case 'deleteProductImage':
        return deleteProductImage(data.fileId);
        
      // Products
      case 'getProducts':
        return getProducts(sessionId);
      case 'addProduct':
        return addProduct(data, sessionId);
      case 'updateProduct':
        return updateProduct(data, sessionId);
      case 'deleteProduct':
        return deleteProduct(data.id, sessionId);
      case 'findProductByBarcode':
        return findProductByBarcode(data.barcode, sessionId);
        
      // Members
      case 'getMembers':
        return getMembers(sessionId);
      case 'addMember':
        return addMember(data, sessionId);
      case 'updateMember':
        return updateMember(data, sessionId);
      case 'deleteMember':
        return deleteMember(data.id, sessionId);
        
      // Sales
      case 'processSale':
        return processSale(data, sessionId);
      case 'getSalesReport':
        return getSalesReport(data.period, data.date, sessionId);
      case 'getRecentSales': // NEW API
        return getRecentSales(sessionId);
      case 'getProfitSharingReport': // NEW: ปันผลกำไร
        return getProfitSharingReport(sessionId);
        
      // *** NEW: User Management (Admin) ***
      case 'getUsers':
        return getUsers(sessionId);
      case 'addUser':
        return addUser(data, sessionId);
      case 'updateUser':
        return updateUser(data, sessionId);
      case 'deleteUser':
        return deleteUser(data, sessionId);

      default:
        return { success: false, message: 'Unknown action: ' + action };
    }
    
  } catch (error) {
    Logger.log('Error in handleApiRequest: ' + error.toString());
    return { success: false, message: 'Internal server error: ' + error.toString() };
  }
}