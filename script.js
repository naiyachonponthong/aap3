<script>
/**
 * script.js - Core Application Logic v2.6
 *
 * - อัปเดต: เปลี่ยนจาก google.script.run เป็น fetch API (GET/POST)
 * - อัปเดต: เพิ่ม Client-side Cache ด้วย TTL
 * - อัปเดต: เพิ่ม localStorage Mock Fallback
 * - อัปเดต: เพิ่ม SheetJS + CSV/Excel Export ฝั่ง Client
 * - อัปเดต: ปรับปรุง QR Scanner ด้วย HTML5-Qrcode
 */

// ===== Configuration =====
// แก้ไข URL นี้เป็น Google Apps Script Web App URL ของคุณ
// วิธีการ: Deploy code.gs เป็น Web App แล้วนำ URL มาใส่ที่นี่
var API_URL = 'https://script.google.com/macros/s/AKfycbyCouYhKVXGxpK_ZeCbU21Tlv7YI-Rpq3m5_nmBg9c6sRxayisdn1awINEckz40KYd1/exec';
var CACHE_TTL = 30000; // 30 วินาที

// ===== Global Variables =====
var currentUser = null;
var sessionId = storage.getItem('schoolCoop_sessionId') || null;
var currentCart = [];
var currentMember = null;
var paymentMethod = 'cash';
var html5QrCode = null;
var products = [];
var members = [];
var users = []; // NEW: For user management
var isScanning = false;
var systemConfig = {};
var editingProduct = null;
var editingMember = null;
var editingUser = null; // NEW: For user management

// ===== Client-side Cache =====
var _cache = {};
var _cacheTime = {};

function getCached(key) {
    var now = Date.now();
    if (_cache[key] && (now - _cacheTime[key]) < CACHE_TTL) {
        return _cache[key];
    }
    return null;
}

function setCache(key, value) {
    _cache[key] = value;
    _cacheTime[key] = Date.now();
}

function clearCache(key) {
    if (key) {
        delete _cache[key];
        delete _cacheTime[key];
    } else {
        _cache = {};
        _cacheTime = {};
    }
}

// ===== localStorage Mock Fallback =====
var _mockStorage = {};
var _localStorageAvailable = (function() {
    try {
        var test = '__test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch (e) {
        return false;
    }
})();

var storage = {
    getItem: function(key) {
        if (_localStorageAvailable) return localStorage.getItem(key);
        return _mockStorage[key] || null;
    },
    setItem: function(key, value) {
        if (_localStorageAvailable) return localStorage.setItem(key, value);
        _mockStorage[key] = String(value);
    },
    removeItem: function(key) {
        if (_localStorageAvailable) return localStorage.removeItem(key);
        delete _mockStorage[key];
    }
};

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    
    // Set default date for reports
    var reportDateEl = document.getElementById('reportDate');
    if (reportDateEl) {
        reportDateEl.value = new Date().toISOString().split('T')[0];
    }
});

/**
 * เริ่มต้นแอปพลิเคชั่น
 */
async function initializeApp() {
    showLoading();
    try {
        // ต้องโหลด Config ก่อนเพื่อตั้งค่าชื่อแอปก่อนแสดง UI
        await loadSystemConfig(); 

        if (sessionId) {
            var result = await validateSession();
            if (result.success) {
                currentUser = result.user;
                showMainApp(); // This will handle UI init
                await loadInitialData();
            } else {
                showLoginForm();
            }
        } else {
            showLoginForm();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showError('เกิดข้อผิดพลาดในการเริ่มต้นระบบ');
        showLoginForm();
    }
    hideLoading();
}

/**
 * ตั้งค่า Event Listeners
 */
function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
    // Product forms
    document.getElementById('addProductForm').addEventListener('submit', handleAddProduct);
    document.getElementById('editProductForm').addEventListener('submit', handleUpdateProduct);
    
    // Member forms
    document.getElementById('addMemberForm').addEventListener('submit', handleAddMember);
    document.getElementById('editMemberForm').addEventListener('submit', handleUpdateMember);
    
    // *** NEW: User forms ***
    document.getElementById('addUserForm').addEventListener('submit', handleAddUser);
    document.getElementById('editUserForm').addEventListener('submit', handleUpdateUser);
    
    // Settings form
    document.getElementById('settingsForm').addEventListener('submit', handleUpdateSettings);
    
    // NEW: Drive Folder Button
    var createDriveFolderBtn = document.getElementById('createDriveFolderBtn');
    if (createDriveFolderBtn) {
        createDriveFolderBtn.addEventListener('click', handleCreateDriveFolder);
    }
    
    // Payment related
    document.getElementById('checkoutBtn').addEventListener('click', handleCheckout);
    document.getElementById('manualBarcode').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchByBarcode();
        }
    });
    
    // Payment method selection
    var paymentButtons = document.querySelectorAll('.payment-method');
    paymentButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            selectPaymentMethod(this.dataset.method);
        });
    });
    
    // Barcode scanner
    document.getElementById('startScanBtn').addEventListener('click', startScanning);
    document.getElementById('stopScanBtn').addEventListener('click', stopScanning);
    
    // Share calculation
    document.getElementById('memberShares').addEventListener('change', calculateShareAmount);
    document.getElementById('editMemberShares').addEventListener('change', calculateEditShareAmount);
    
    // Cash payment calculation
    document.getElementById('receivedAmount').addEventListener('input', calculateChange);
    
    // Barcode display update
    document.getElementById('productBarcode').addEventListener('input', updateBarcodeDisplay);
    
    // Close modals with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // hideModal logic is in js.js, but we can also trigger it for image popup
            hideImagePopup();
        }
    });
}

// ===== Image Popup Functions =====

/**
 * แสดง popup รูปภาพใหญ่
 */
function showImagePopup(imageUrl, caption) {
    if (!imageUrl) return;
    
    document.getElementById('popupImage').src = imageUrl;
    document.getElementById('popupImageCaption').textContent = caption || '';
    document.getElementById('imagePopupModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

/**
 * ซ่อน popup รูปภาพ
 */
function hideImagePopup() {
    document.getElementById('imagePopupModal').classList.add('hidden');
    // Let hideModal (from js.js) handle the body overflow if other modals are open
    if (typeof hideModal === 'function') {
        hideModal('imagePopupModal'); // Call the generic hide to check body overflow
    } else {
        document.body.style.overflow = 'auto';
    }
}

// ===== Authentication Functions =====

/**
 * จัดการการล็อกอิน
 */
async function handleLogin(e) {
    e.preventDefault();
    var username = document.getElementById('username').value;
    var password = document.getElementById('password').value;
    
    if (!username || !password) {
        showError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
        return;
    }
    
    showLoading();
    console.log('[LOGIN] Starting login for:', username);
    try {
        var result = await apiCall('login', { username: username, password: password });
        console.log('[LOGIN] API result:', result);
        
        if (result && result.success) {
            sessionId = result.sessionId;
            currentUser = result.user;
            storage.setItem('schoolCoop_sessionId', sessionId);
            
            showSuccess('เข้าสู่ระบบสำเร็จ');
            showMainApp();
            await loadInitialData();
        } else {
            console.error('[LOGIN] Login failed:', result);
            showError(result && result.message ? result.message : 'ไม่สามารถเข้าสู่ระบบได้');
        }
    } catch (error) {
        console.error('[LOGIN] Exception:', error);
        showError('เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + (error.message || error));
    }
    hideLoading();
}

/**
 * จัดการการล็อกเอาท์
 */
async function handleLogout() {
    try {
        var confirmed = await Swal.fire({
            title: 'ต้องการออกจากระบบ?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'ออกจากระบบ',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280'
        });
        
        if (confirmed.isConfirmed) {
            showLoading();
            await apiCall('logout', {}, sessionId);
            
            storage.removeItem('schoolCoop_sessionId');
            sessionId = null;
            currentUser = null;
            currentCart = [];
            
            document.getElementById('loginForm').reset();
            
            showSuccess('ออกจากระบบเรียบร้อย');
            showLoginForm();
            hideLoading();
        }
    } catch (error) {
        console.error('Logout error:', error);
        showError('เกิดข้อผิดพลาดในการออกจากระบบ');
        hideLoading();
    }
}

/**
 * ตรวจสอบ Session
 */
async function validateSession() {
    try {
        var result = await apiCall('validateSession', {}, sessionId);
        return result;
    } catch (error) {
        console.error('Session validation error:', error);
        return { success: false, message: 'Session validation failed' };
    }
}

// ===== UI Functions (Core) =====

/**
 * แสดงหน้าล็อกอิน
 */
function showLoginForm() {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('username').focus();
}

/**
 * *** UPDATED: แสดงแอปหลัก ***
 * (เรียกใช้ UI/Navigation logic จาก js.js)
 */
function showMainApp() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    if (currentUser) {
        document.getElementById('userDisplayName').textContent = currentUser.name;
        document.getElementById('userRole').textContent = currentUser.role;
    }
    
    // *** NEW: Initialize UI from js.js ***
    if (typeof initializeSidebar === 'function') {
        initializeSidebar();
    }
    if (typeof showDashboard === 'function') {
        showDashboard();
    }
}


// ===== Loading Counter (Prevent nested loading issues) =====
window.loadingCounter = 0;

/**
 * แสดงการโหลด
 */
function showLoading(message) {
    window.loadingCounter++;
    var spinner = document.getElementById('loadingSpinner');
    var spinnerText = spinner ? spinner.querySelector('.spinner-text') : null;
    
    if (spinner) {
        spinner.classList.remove('hidden');
        spinner.style.zIndex = '9999';
    }
    
    // อัพเดทข้อความ
    if (spinnerText) {
        if (message) {
            spinnerText.textContent = message;
        }
    }
}

/**
 * ซ่อนการโหลด
 */
function hideLoading(delay = 0) {
    window.loadingCounter--;
    
    const doHide = () => {
        if (window.loadingCounter <= 0) {
            window.loadingCounter = 0; // Reset to 0
            var spinner = document.getElementById('loadingSpinner');
            if (spinner) {
                spinner.classList.add('hidden');
            }
        }
    };
    
    if (delay > 0) {
        setTimeout(doHide, delay);
    } else {
        doHide();
    }
}

/**
 * Force ซ่อนการโหลดทั้งหมด (สำหรับเมื่อสลับหน้า)
 */
function hideAllLoading() {
    window.loadingCounter = 0;
    var spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.classList.add('hidden');
    }
}

/**
 * อัพเดทสถิติใน Sidebar
 */
function updateSidebarStats() {
    var todaySalesElement = document.getElementById('sidebarTodaySales');
    var todayTransactionsElement = document.getElementById('sidebarTodayTransactions');
    
    if (todaySalesElement && todayTransactionsElement) {
        var mainTodaySales = document.getElementById('todaySales');
        var mainTodayTransactions = document.getElementById('todayTransactions');
        
        if (mainTodaySales && mainTodayTransactions) {
            todaySalesElement.textContent = mainTodaySales.textContent;
            var transactionText = mainTodayTransactions.textContent;
            var transactionNumber = transactionText.replace(' รายการ', '');
            todayTransactionsElement.textContent = transactionNumber;
        }
    }
}

/**
 * NEW: อัปเดตชื่อแอปและเวอร์ชันใน UI
 */
function updateAppUI(config) {
    var appName = config.app_name || 'ระบบร้านค้าสหกรณ์';
    var appVersion = config.app_version || 'vN/A';
    
    // 1. Title Bar
    document.title = appName;

    // 2. Login Modal
    var loginAppNameEl = document.getElementById('loginAppName');
    if (loginAppNameEl) loginAppNameEl.textContent = appName;

    // 3. Navbar App Name
    var navbarAppNameEl = document.getElementById('navbarAppName');
    if (navbarAppNameEl) navbarAppNameEl.textContent = appName;
    
    // 4. Navbar App Version
    var navbarAppVersionEl = document.getElementById('navbarAppVersion');
    if (navbarAppVersionEl) navbarAppVersionEl.textContent = `ระบบจัดการร้านค้า ${appVersion} (Collapsible)`;
}


// ===== Data Loading Functions =====

/**
 * โหลดข้อมูลเริ่มต้น (หลังจาก Login)
 */
async function loadInitialData() {
    try {
        // โหลดข้อมูลหลักพร้อมกัน (Parallel)
        // ไม่ต้องโหลด loadUsers ถ้าเป็น cashier เพราะไม่ได้ใช้
        const loadTasks = [
            loadProducts(),
            loadMembers(),
            loadDashboardRefresh()
        ];
        
        // ถ้าเป็น admin ให้โหลด users ด้วย
        if (currentUser && currentUser.role === 'admin') {
            loadTasks.push(loadUsers());
        }
        
        await Promise.all(loadTasks);
    } catch (error) {
        console.error('Error loading initial data:', error);
        showError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    }
}

/**
 * โหลดการตั้งค่าระบบ (ต้องถูกเรียกก่อน Initial App)
 */
async function loadSystemConfig() {
    try {
        var result = await apiCall('getConfig', {}, sessionId);
        if (result.success) {
            systemConfig = result.config;
            var sharePriceEl = document.getElementById('sharePrice');
            if (sharePriceEl) sharePriceEl.value = systemConfig.share_price || 10;
            calculateShareAmount();
            updateAppUI(systemConfig); // Update UI elements
        }
    } catch (error) {
        console.error('Error loading system config:', error);
    }
}

/**
 * NEW: โหลดและอัปเดตสถิติ Dashboard ทั้งหมด
 */
async function loadDashboardRefresh() {
    showLoading();
    try {
        // โหลดข้อมูล Dashboard ทั้งหมดแบบ Parallel (พร้อมกัน)
        await Promise.all([
            loadDashboardStats(),        // 1. สถิติหลัก
            loadRecentActivities(),      // 2. กิจกรรมล่าสุด
            loadQuickChartData()         // 3. Quick Chart
        ]);
        
    } catch (error) {
        console.error('Error refreshing dashboard data:', error);
    } finally {
        hideLoading(100); // เล็กน้อยเวลา render ก่อน
    }
}

/**
 * โหลดสถิติหลัก Dashboard
 */
async function loadDashboardStats() {
    try {
        var today = new Date().toISOString().split('T')[0];
        var result = await apiCall('getSalesReport', { 
            period: 'daily', 
            date: today 
        }, sessionId);
        
        if (result.success && result.report) {
            var report = result.report;
            var todaySalesEl = document.getElementById('todaySales');
            var todayTransactionsEl = document.getElementById('todayTransactions');
            var totalMembersEl = document.getElementById('totalMembers');
            var totalProductsEl = document.getElementById('totalProducts');
            var lowStockCountEl = document.getElementById('lowStockCount');

            if (todaySalesEl) todaySalesEl.textContent = formatCurrency(report.summary.total_sales);
            if (todayTransactionsEl) todayTransactionsEl.textContent = report.summary.total_transactions + ' รายการ';
            if (totalMembersEl) totalMembersEl.textContent = members.length; // Use client-side member count
            if (totalProductsEl) totalProductsEl.textContent = products.length; // Use client-side product count
            
            // Calculate low stock count based on loaded products
            var lowStockCount = products.filter(p => p.stock <= p.min_stock).length;
            if (lowStockCountEl) lowStockCountEl.textContent = lowStockCount;
            
            // Update sidebar stats
            updateSidebarStats();
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

/**
 * NEW: โหลดกิจกรรมล่าสุดจาก API จริง
 */
async function loadRecentActivities() {
    var recentSalesContainer = document.getElementById('recentSales');
    if (!recentSalesContainer) return;

    try {
        var result = await apiCall('getRecentSales', {}, sessionId);

        if (result.success && result.recentSales) {
            var recentSales = result.recentSales;
        
            if (recentSales.length === 0) {
                recentSalesContainer.innerHTML = 
                    '<div class="text-center text-gray-500 py-8">' +
                        '<i class="fas fa-receipt text-4xl mb-4 opacity-50"></i>' +
                        '<p>ไม่มีข้อมูลการขายล่าสุด</p>' +
                    '</div>';
            } else {
                var activitiesHtml = '';
                recentSales.forEach(function(sale) {
                    activitiesHtml += 
                        '<div class="recent-activity-item flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg">' +
                            '<div class="flex items-center space-x-3">' +
                                 '<div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">' +
                                    '<i class="fas fa-shopping-basket text-green-600"></i>' +
                                 '</div>' +
                                 '<div>' +
                                    '<p class="font-medium text-gray-900">' + sale.item + ' (' + sale.id.slice(-8).toUpperCase() + ')</p>' +
                                    '<p class="text-sm text-gray-500">' + sale.time + ' • ' + sale.customer + '</p>' +
                                 '</div>' +
                            '</div>' +
                            '<div class="text-right">' +
                                '<p class="font-bold text-green-600">' + (typeof formatCurrency === 'function' ? formatCurrency(sale.amount) : sale.amount) + '</p>' +
                            '</div>' +
                        '</div>';
                });
                recentSalesContainer.innerHTML = activitiesHtml;
            }
        } else {
             recentSalesContainer.innerHTML = '<div class="text-center text-red-500 py-8"><i class="fas fa-exclamation-triangle text-2xl mb-2"></i><p>เกิดข้อผิดพลาดในการโหลดกิจกรรมล่าสุด</p></div>';
        }
    } catch (error) {
        console.error('Error loading recent activities:', error);
        recentSalesContainer.innerHTML = 
            '<div class="text-center text-red-500 py-8">' +
                '<i class="fas fa-exclamation-triangle text-2xl mb-2"></i>' +
                '<p>เกิดข้อผิดพลาดในการโหลดข้อมูล</p>' +
            '</div>';
    }
}

/**
 * NEW: โหลดข้อมูล 7 วันล่าสุดสำหรับ Quick Chart
 */
async function loadQuickChartData() {
    try {
        // ใช้ 7 วันล่าสุด
        const today = new Date().toISOString().split('T')[0];
        const result = await apiCall('getSalesReport', { period: 'weekly', date: today }, sessionId);

        if (result.success && result.report && result.report.daily_sales) {
            const dailyData = result.report.daily_sales;
            
            // Prepare data for chart
            const labels = dailyData.map(day => new Date(day.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
            const salesData = dailyData.map(day => day.amount);

            // Call the function in js.js (which handles chart drawing)
            if (typeof loadQuickChart === 'function') {
                loadQuickChart(salesData, labels);
            }
        } else {
             // Fallback to mock data if API call fails
             if (typeof loadQuickChart === 'function') loadQuickChart(); 
        }

    } catch (error) {
        console.error('Error loading quick chart data:', error);
        // Fallback to mock data on error
        if (typeof loadQuickChart === 'function') loadQuickChart(); 
    }
}


/**
 * โหลดข้อมูลสินค้า
 */
async function loadProducts() {
    try {
        var result = await apiCall('getProducts', {}, sessionId);
        if (result.success) {
            products = result.products;
            updateProductGrid(); // Update sales page grid
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

/**
 * โหลดข้อมูลสมาชิก
 */
async function loadMembers() {
    try {
        var result = await apiCall('getMembers', {}, sessionId);
        if (result.success) {
            members = result.members;
            updateMemberSelect();
        }
    } catch (error) {
        console.error('Error loading members:', error);
    }
}

/**
 * *** NEW: โหลดข้อมูลผู้ใช้งาน (Admin) ***
 */
async function loadUsers() {
    if (!currentUser || currentUser.role !== 'admin') {
        users = [];
        return;
    }
    try {
        // เพิ่ม timeout 15 วินาที (หาก API ช้ากว่า 15 วินาทีก็ให้ timeout)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        var result = await apiCall('getUsers', {}, sessionId);
        clearTimeout(timeoutId);
        
        if (result.success) {
            users = result.users;
        } else {
            console.warn('Failed to load users:', result.message);
        }
    } catch (error) {
        console.error('Error loading users:', error);
        // ให้เก็บ users ที่เก่าไว้ แทนจะล้าง
        if (users.length === 0) {
            users = [];
        }
    }
}


// ===== Product Management =====

/**
 * *** UPDATED: จัดการการเพิ่มสินค้า ***
 * (Callback logic changed)
 */
async function handleAddProduct(e) {
    e.preventDefault();
    var imageUrl = '';
    var fileInput = document.getElementById('productImage');
    
    if (fileInput.files && fileInput.files[0]) {
        showLoading('กำลังอัพโหลดรูปภาพ...');
        var uploadResult = await uploadProductImage(fileInput.files[0]);
        hideLoading();
        if (!uploadResult.success) {
            showError('ไม่สามารถอัพโหลดรูปภาพได้: ' + uploadResult.message);
            return;
        }
        imageUrl = uploadResult.imageUrl;
    }
    
    var productData = {
        name: document.getElementById('productName').value,
        category: document.getElementById('productCategory').value,
        price: parseFloat(document.getElementById('productPrice').value),
        cost: parseFloat(document.getElementById('productCost').value) || 0,
        stock: parseInt(document.getElementById('productStock').value),
        min_stock: parseInt(document.getElementById('productMinStock').value) || 5,
        unit: document.getElementById('productUnit').value || 'ชิ้น',
        description: document.getElementById('productDescription').value,
        barcode: document.getElementById('productBarcode').value,
        image_url: imageUrl
    };
    
    if (!productData.name || !productData.price || productData.stock < 0) {
        showError('กรุณากรอกข้อมูลที่จำเป็น');
        return;
    }
    
    showLoading('กำลังเพิ่มสินค้า...');
    try {
        var result = await apiCall('addProduct', productData, sessionId);
        if (result.success) {
            showSuccess('เพิ่มสินค้าเรียบร้อย');
            hideModal('addProductModal'); // Use function from js.js
            resetForm('addProductForm');
            var imagePreviewEl = document.getElementById('imagePreview');
            var barcodeDisplayEl = document.getElementById('barcodeDisplay');
            if (imagePreviewEl) imagePreviewEl.classList.add('hidden');
            if (barcodeDisplayEl) barcodeDisplayEl.classList.add('hidden');
            
            // Refresh data
            await loadProducts();
            await loadDashboardRefresh(); // Update stats & recent activity
            loadProductManagement(); // Refresh the management page list
        } else {
            showError(result.message || 'ไม่สามารถเพิ่มสินค้าได้');
        }
    } catch (error) {
        console.error('Add product error:', error);
        showError('เกิดข้อผิดพลาดในการเพิ่มสินค้า');
    }
    hideLoading();
}

/**
 * อัพโหลดรูปภาพสินค้า
 */
async function uploadProductImage(file) {
  try {
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return { success: false, message: 'ไฟล์มีขนาดใหญ่เกิน 5MB' };
    }
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return { success: false, message: 'ประเภทไฟล์ไม่รองรับ' };
    }

    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = async function(e) {
        try {
          var fileData = {
            name: 'product_' + Date.now() + '_' + file.name,
            content: e.target.result,
            mimeType: file.type
          };
          var result = await apiCall('uploadFile', fileData, sessionId);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = function() {
        reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
      };
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error('Upload image error:', error);
    return { success: false, message: error.message };
  }
}

/**
 * แสดงตัวอย่างรูปภาพ (เพิ่มสินค้า)
 */
function previewImage(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var previewImgEl = document.getElementById('previewImg');
            var imagePreviewEl = document.getElementById('imagePreview');
            if (previewImgEl) previewImgEl.src = e.target.result;
            if (imagePreviewEl) imagePreviewEl.classList.remove('hidden');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * แสดงตัวอย่างรูปภาพ (แก้ไขสินค้า)
 */
function previewEditImage(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var editPreviewImgEl = document.getElementById('editPreviewImg');
            var editImagePreviewEl = document.getElementById('editImagePreview');
            if (editPreviewImgEl) editPreviewImgEl.src = e.target.result;
            if (editImagePreviewEl) editImagePreviewEl.classList.remove('hidden');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * ตัวอย่าง QR Code พร้อมเพย์
 */
function previewPromptpayQR(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var promptpayQRPreviewImgEl = document.getElementById('promptpayQRPreviewImg');
            var promptpayQRPreviewEl = document.getElementById('promptpayQRPreview');
            if (promptpayQRPreviewImgEl) promptpayQRPreviewImgEl.src = e.target.result;
            if (promptpayQRPreviewEl) promptpayQRPreviewEl.classList.remove('hidden');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * *** UPDATED: จัดการการแก้ไขสินค้า ***
 */
async function handleUpdateProduct(e) {
    e.preventDefault();
    var imageUrl = document.getElementById('editProductImageUrl').value;
    var fileInput = document.getElementById('editProductImage');
    
    if (fileInput.files && fileInput.files[0]) {
        showLoading('กำลังอัพโหลดรูปภาพ...');
        var uploadResult = await uploadProductImage(fileInput.files[0]);
        if (!uploadResult.success) {
            hideLoading();
            showError('ไม่สามารถอัพโหลดรูปภาพได้: ' + uploadResult.message);
            return;
        }
        imageUrl = uploadResult.imageUrl;
        hideLoading();
    }
    
    var productData = {
        id: document.getElementById('editProductId').value,
        name: document.getElementById('editProductName').value,
        category: document.getElementById('editProductCategory').value,
        price: parseFloat(document.getElementById('editProductPrice').value),
        cost: parseFloat(document.getElementById('editProductCost').value) || 0,
        stock: parseInt(document.getElementById('editProductStock').value),
        min_stock: parseInt(document.getElementById('editProductMinStock').value) || 5,
        unit: document.getElementById('editProductUnit').value || 'ชิ้น',
        description: document.getElementById('editProductDescription').value,
        barcode: document.getElementById('editProductBarcode').value,
        image_url: imageUrl
    };
    
    showLoading('กำลังบันทึกสินค้า...');
    try {
        var result = await apiCall('updateProduct', productData, sessionId);
        if (result.success) {
            showSuccess('แก้ไขสินค้าเรียบร้อย');
            hideModal('editProductModal');
            
            // Refresh data
            await loadProducts();
            await loadDashboardRefresh();
            loadProductManagement(); // Refresh the list
        } else {
            showError(result.message || 'ไม่สามารถแก้ไขสินค้าได้');
        }
    } catch (error) {
        console.error('Update product error:', error);
        showError('เกิดข้อผิดพลาดในการแก้ไขสินค้า');
    }
    hideLoading();
}

/**
 * ลบสินค้า
 */
async function deleteProduct(productId, productName) {
    try {
        var confirmed = await Swal.fire({
            title: 'ยืนยันการลบสินค้า',
            text: 'ต้องการลบสินค้า "' + productName + '" ใช่หรือไม่?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ลบสินค้า',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280'
        });
        
        if (confirmed.isConfirmed) {
            showLoading('กำลังลบสินค้า...');
            var result = await apiCall('deleteProduct', { id: productId }, sessionId);
            if (result.success) {
                showSuccess('ลบสินค้าเรียบร้อย');
                
                // Refresh data
                await loadProducts();
                await loadDashboardRefresh();
                loadProductManagement();
            } else {
                showError(result.message || 'ไม่สามารถลบสินค้าได้');
            }
            hideLoading();
        }
    } catch (error) {
        console.error('Delete product error:', error);
        showError('เกิดข้อผิดพลาดในการลบสินค้า');
        hideLoading();
    }
}

/**
 * แก้ไขสินค้า - เปิด Modal
 */
function editProduct(productId) {
    var product = products.find(p => p.id === productId);
    if (!product) {
        showError('ไม่พบข้อมูลสินค้า');
        return;
    }
    
    editingProduct = product;
    
    var editProductIdEl = document.getElementById('editProductId');
    var editProductNameEl = document.getElementById('editProductName');
    var editProductCategoryEl = document.getElementById('editProductCategory');
    var editProductPriceEl = document.getElementById('editProductPrice');
    var editProductCostEl = document.getElementById('editProductCost');
    var editProductStockEl = document.getElementById('editProductStock');
    var editProductMinStockEl = document.getElementById('editProductMinStock');
    var editProductUnitEl = document.getElementById('editProductUnit');
    var editProductDescriptionEl = document.getElementById('editProductDescription');
    var editProductBarcodeEl = document.getElementById('editProductBarcode');
    var editProductImageUrlEl = document.getElementById('editProductImageUrl');
    var editImagePreviewEl = document.getElementById('editImagePreview');
    var editPreviewImgEl = document.getElementById('editPreviewImg');
    var editBarcodeDisplayEl = document.getElementById('editBarcodeDisplay');
    var editBarcodeImageEl = document.getElementById('editBarcodeImage');
    var editBarcodeTextEl = document.getElementById('editBarcodeText');
    
    
    if (editProductIdEl) editProductIdEl.value = product.id;
    if (editProductNameEl) editProductNameEl.value = product.name;
    if (editProductCategoryEl) editProductCategoryEl.value = product.category;
    if (editProductPriceEl) editProductPriceEl.value = product.price;
    if (editProductCostEl) editProductCostEl.value = product.cost || 0;
    if (editProductStockEl) editProductStockEl.value = product.stock;
    if (editProductMinStockEl) editProductMinStockEl.value = product.min_stock;
    if (editProductUnitEl) editProductUnitEl.value = product.unit;
    if (editProductDescriptionEl) editProductDescriptionEl.value = product.description || '';
    if (editProductBarcodeEl) editProductBarcodeEl.value = product.barcode;
    if (editProductImageUrlEl) editProductImageUrlEl.value = product.image_url || '';
    
    if (product.image_url) {
        if (editPreviewImgEl) editPreviewImgEl.src = product.image_url;
        if (editImagePreviewEl) editImagePreviewEl.classList.remove('hidden');
    } else {
        if (editImagePreviewEl) editImagePreviewEl.classList.add('hidden');
    }
    
    if (product.barcode_image_url) {
        if (editBarcodeImageEl) editBarcodeImageEl.src = product.barcode_image_url;
        if (editBarcodeTextEl) editBarcodeTextEl.textContent = product.barcode;
        if (editBarcodeDisplayEl) editBarcodeDisplayEl.classList.remove('hidden');
    } else {
        if (editBarcodeDisplayEl) editBarcodeDisplayEl.classList.add('hidden');
    }
    
    showModal('editProductModal'); // Use function from js.js
}

/**
 * โหลดหน้าจัดการสินค้า
 */
/**
 * โหลดหน้าจัดการสินค้า (ตารางแบบใหม่)
 */
function loadProductManagement() {
    var container = document.getElementById('productManagementList');
    if (!container) return;
    
    container.innerHTML = '';
    
    var filtered = products.filter(p => {
        var searchInput = document.getElementById('productSearchInputManage');
        var searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        return !searchTerm || p.name.toLowerCase().includes(searchTerm) || p.barcode.toLowerCase().includes(searchTerm) || p.category.toLowerCase().includes(searchTerm);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-8"><p class="text-gray-500">ไม่พบสินค้า</p></div>';
        return;
    }
    
    // สร้างตารางสินค้า
    var tableHtml = '<table class="management-table" style="width: 100%; border-collapse: collapse;">';
    
    // Header
    tableHtml += `
        <thead style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
            <tr>
                <th style="width: 5%; padding: 12px 16px; text-align: center; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">#</th>
                <th style="width: 30%; padding: 12px 16px; text-align: left; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">ชื่อสินค้า</th>
                <th style="width: 12%; padding: 12px 16px; text-align: left; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">หมวด</th>
                <th style="width: 10%; padding: 12px 16px; text-align: center; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">ราคา</th>
                <th style="width: 10%; padding: 12px 16px; text-align: center; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">สต็อก</th>
                <th style="width: 18%; padding: 12px 16px; text-align: center; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">บาร์โค้ด</th>
                <th style="width: 15%; padding: 12px 16px; text-align: center; font-weight: 600; color: #4b5563; text-transform: uppercase; font-size: 12px;">จัดการ</th>
            </tr>
        </thead>
        <tbody>`;
    
    // Body
    filtered.forEach(function(product, index) {
        var stockStatus = getStockStatus(product);
        var stockClass = getStockClass(product);
        var defaultImage = systemConfig.default_product_image || 'https://via.placeholder.com/64';
        
        var barcodeDisplay = product.barcode;
        if (product.barcode_image_url) {
            barcodeDisplay = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                    <img src="${product.barcode_image_url}" alt="Barcode" style="height: 32px; cursor: pointer;" 
                    onclick="showImagePopup('${product.barcode_image_url}', 'บาร์โค้ด: ${product.barcode}')" title="คลิกเพื่อดูภาพใหญ่">
                    <code style="font-size: 11px; color: #4b5563;">${product.barcode}</code>
                </div>`;
        } else {
            barcodeDisplay = `<code style="font-size: 11px; color: #4b5563;">${product.barcode}</code>`;
        }
        
        var imageHtml = `
            <img src="${product.image_url || defaultImage}" alt="${product.name}" 
            style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; cursor: pointer;"
            onclick="showImagePopup('${product.image_url || defaultImage}', '${product.name}')" title="คลิกเพื่อดูภาพใหญ่">`;
        
        tableHtml += `
            <tr style="border-bottom: 1px solid #e5e7eb; transition: background-color 0.2s ease;">
                <td style="padding: 16px; text-align: center; font-weight: 600; color: #3b82f6;">${index + 1}</td>
                <td style="padding: 16px; text-align: left;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        ${imageHtml}
                        <div style="flex: 1;">
                            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">${product.name}</div>
                            <div style="font-size: 12px; color: #6b7280;">ต้นทุน: <span style="font-weight: 600; color: #ef4444;">${formatCurrency(product.cost)}</span></div>
                        </div>
                    </div>
                </td>
                <td style="padding: 16px; text-align: left;">
                    <span style="background-color: #f3f4f6; color: #4b5563; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
                        ${product.category}
                    </span>
                </td>
                <td style="padding: 16px; text-align: center; font-weight: 600; color: #059669; font-size: 14px;">${formatCurrency(product.price)}</td>
                <td style="padding: 16px; text-align: center;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="font-weight: 500; color: #1f2937;">${product.stock}</span>
                        <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; ${stockClass === 'bg-green-100 text-green-800' ? 'background-color: #dcfce7; color: #166534;' : stockClass === 'bg-yellow-100 text-yellow-800' ? 'background-color: #fef3c7; color: #92400e;' : 'background-color: #fee2e2; color: #991b1b;'}">${stockStatus}</span>
                    </div>
                </td>
                <td style="padding: 16px; text-align: center;">${barcodeDisplay}</td>
                <td style="padding: 16px; text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="editProduct('${product.id}')" 
                        style="background-color: #3b82f6; color: white; padding: 6px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.3s ease; white-space: nowrap;">
                            <i class="fas fa-edit" style="margin-right: 4px;"></i>แก้ไข
                        </button>
                        <button onclick="deleteProduct('${product.id}', '${product.name.replace(/'/g, "\\'")}')" 
                        style="background-color: #ef4444; color: white; padding: 6px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.3s ease; white-space: nowrap;">
                            <i class="fas fa-trash" style="margin-right: 4px;"></i>ลบ
                        </button>
                    </div>
                </td>
            </tr>`;
    });
    
    tableHtml += `
        </tbody>
        </table>`;
    
    container.innerHTML = tableHtml;
    
    // เพิ่ม Hover effect ผ่าน event listener
    var rows = container.querySelectorAll('tbody tr');
    rows.forEach(function(row) {
        row.addEventListener('mouseover', function() {
            this.style.backgroundColor = '#f9fafb';
        });
        row.addEventListener('mouseout', function() {
            this.style.backgroundColor = 'transparent';
        });
    });
}

/**
 * *** UPDATED: กรองสินค้า (หน้าจัดการ) ***
 */
function filterProducts() {
    // This function is now just a trigger for loadProductManagement
    loadProductManagement();
}

/**
 * สร้างบาร์โค้ดใหม่
 */
function generateNewBarcode() {
    var timestamp = Date.now().toString().slice(-8);
    var random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    var prefix = systemConfig.barcode_prefix || 'SCH';
    var barcode = prefix + timestamp + random;
    var productBarcodeEl = document.getElementById('productBarcode');
    if (productBarcodeEl) productBarcodeEl.value = barcode;
    updateBarcodeDisplay();
}

/**
 * แสดงบาร์โค้ดเมื่อพิมพ์ด้วยตัวเอง
 */
function updateBarcodeDisplay() {
    var productBarcodeEl = document.getElementById('productBarcode');
    var barcodeImageEl = document.getElementById('barcodeImage');
    var barcodeTextEl = document.getElementById('barcodeText');
    var barcodeDisplayEl = document.getElementById('barcodeDisplay');
    
    if (!productBarcodeEl || !barcodeImageEl || !barcodeTextEl || !barcodeDisplayEl) return;

    var barcode = productBarcodeEl.value.trim();
    if (barcode) {
        var barcodeImageUrl = 'https://barcode.tec-it.com/barcode.ashx?data=' + barcode + '&code=Code128&multiplebarcodes=false&translate-esc=false&unit=Fit&dpi=96&imagetype=Gif&rotation=0&color=%23000000&bgcolor=%23ffffff&qunit=Mm&quiet=0';
        barcodeImageEl.src = barcodeImageUrl;
        barcodeTextEl.textContent = barcode;
        barcodeDisplayEl.classList.remove('hidden');
    } else {
        barcodeDisplayEl.classList.add('hidden');
    }
}

/**
 * อัพเดทตารางสินค้าในหน้าขาย (Grid)
 */
function updateProductGrid() {
    var productGrid = document.getElementById('productGrid');
    if (!productGrid) return;
    
    productGrid.innerHTML = '';
    
    var filteredProducts = getFilteredProducts();
    
    if (filteredProducts.length === 0) {
        productGrid.innerHTML = '<p class="col-span-full text-gray-500 text-center">ไม่พบสินค้าที่ตรงกับการค้นหา</p>';
        return;
    }
    
    var hasStock = false;
    filteredProducts.forEach(function(product) {
        if (product.stock > 0) {
            hasStock = true;
            var productCard = document.createElement('div');
            productCard.className = 'product-grid-card bg-white border-2 border-gray-200 rounded-lg p-3 cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all transform hover:scale-105 shadow-sm hover:shadow-md';
            productCard.onclick = function() { addToCart(product); };
            
            var stockClass = getStockClass(product);
            var defaultImage = systemConfig.default_product_image || 'https://via.placeholder.com/80';
            var categoryBadge = getCategoryBadge(product.category);
            
            productCard.innerHTML = `
                <div class="text-center relative">
                    <div class="relative">
                        <img src="${product.image_url || defaultImage}" alt="${product.name}" 
                        class="product-image w-20 h-20 object-cover rounded-lg mx-auto mb-2 border-2 border-gray-200 cursor-pointer" 
                        onclick="event.stopPropagation(); showImagePopup('${product.image_url || defaultImage}', '${product.name}')" 
                        title="คลิกเพื่อดูภาพใหญ่">
                        <div class="absolute -top-1 -right-1">${categoryBadge}</div>
                    </div>
                    <h4 class="font-medium text-sm text-gray-900 mb-1 truncate" title="${product.name}">${product.name}</h4>
                    <p class="font-bold text-green-600 text-lg mb-1">${formatCurrency(product.price)}</p>
                    <div class="flex items-center justify-center space-x-1 mb-2">
                        <span class="${stockClass} text-xs px-2 py-1 rounded-full">${product.stock} ${product.unit}</span>
                    </div>
                    <div class="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
                        <i class="fas fa-plus mr-1"></i>คลิกเพื่อเพิ่ม
                    </div>
                </div>`;
            productGrid.appendChild(productCard);
        }
    });
    
    if (!hasStock && filteredProducts.length > 0) {
        productGrid.innerHTML = '<p class="col-span-full text-gray-500 text-center">สินค้าที่ค้นหามีแต่ของหมดสต็อก</p>';
    }
}


/**
 * กรองสินค้าในตาราง (Payment Modal)
 */
function filterProductGrid() {
    updateProductGrid();
}

/**
 * ได้รายการสินค้าที่กรองแล้ว (Payment Modal)
 */
function getFilteredProducts() {
    var productSearchInputEl = document.getElementById('productSearchInput');
    var categoryFilterEl = document.getElementById('categoryFilter');

    var searchTerm = productSearchInputEl ? productSearchInputEl.value.toLowerCase() : '';
    var categoryFilter = categoryFilterEl ? categoryFilterEl.value : '';
    
    return products.filter(function(product) {
        var matchSearch = !searchTerm || 
            product.name.toLowerCase().includes(searchTerm) ||
            product.barcode.toLowerCase().includes(searchTerm) ||
            (product.description && product.description.toLowerCase().includes(searchTerm));
        var matchCategory = !categoryFilter || product.category === categoryFilter;
        return matchSearch && matchCategory && product.active;
    });
}

/**
 * สร้าง badge หมวดหมู่
 */
function getCategoryBadge(category) {
    var colors = {
        'อาหาร': 'bg-orange-100 text-orange-800',
        'เครื่องดื่ม': 'bg-blue-100 text-blue-800',
        'ขนม': 'bg-yellow-100 text-yellow-800',
        'เครื่องเขียน': 'bg-purple-100 text-purple-800',
        'อื่นๆ': 'bg-gray-100 text-gray-800'
    };
    var colorClass = colors[category] || colors['อื่นๆ'];
    return `<span class="${colorClass} text-xs px-1 py-0.5 rounded-full font-medium">${category}</span>`;
}

/**
 * ได้สถานะสต็อก
 */
function getStockStatus(product) {
    if (product.stock === 0) return 'หมด';
    if (product.stock <= product.min_stock) return 'เหลือน้อย';
    return 'มีสินค้า';
}

/**
 * ได้คลาส CSS สำหรับสถานะสต็อก
 */
function getStockClass(product) {
    if (product.stock === 0) return 'bg-red-100 text-red-800';
    if (product.stock <= product.min_stock) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
}

// ===== Member Management =====

/**
 * *** UPDATED: จัดการการเพิ่มสมาชิก ***
 */
async function handleAddMember(e) {
    e.preventDefault();
    showLoading('กำลังบันทึกสมาชิก...');
    var memberData = {
        student_id: document.getElementById('memberStudentId').value,
        firstname: document.getElementById('memberFirstname').value,
        lastname: document.getElementById('memberLastname').value,
        classroom: document.getElementById('memberClassroom').value,
        shares: parseInt(document.getElementById('memberShares').value)
    };
    
    if (!memberData.student_id || !memberData.firstname || !memberData.lastname || !memberData.classroom) {
        showError('กรุณากรอกข้อมูลที่จำเป็น');
        hideLoading();
        return;
    }
    
    try {
        var result = await apiCall('addMember', memberData, sessionId);
        if (result.success) {
            showSuccess('เพิ่มสมาชิกเรียบร้อย');
            hideModal('addMemberModal');
            resetForm('addMemberForm');
            calculateShareAmount();
            
            // Refresh data
            await loadMembers();
            await loadDashboardRefresh(); // Refresh list
            loadMemberManagement();
        } else {
            showError(result.message || 'ไม่สามารถเพิ่มสมาชิกได้');
        }
    } catch (error) {
        console.error('Add member error:', error);
        showError('เกิดข้อผิดพลาดในการเพิ่มสมาชิก');
    }
    hideLoading();
}

/**
 * คำนวณจำนวนเงินจากหุ้น
 */
function calculateShareAmount() {
    var memberSharesEl = document.getElementById('memberShares');
    var sharePriceEl = document.getElementById('sharePrice');
    var totalShareAmountEl = document.getElementById('totalShareAmount');
    
    var shares = parseInt(memberSharesEl ? memberSharesEl.value : 1) || 1;
    var pricePerShare = parseInt(sharePriceEl ? sharePriceEl.value : 10) || 10;
    var total = shares * pricePerShare;
    
    if (totalShareAmountEl) totalShareAmountEl.textContent = formatCurrency(total);
}

/**
 * คำนวณจำนวนเงินจากหุ้น (สำหรับแก้ไข)
 */
function calculateEditShareAmount() {
    var editMemberSharesEl = document.getElementById('editMemberShares');
    var editSharePriceEl = document.getElementById('editSharePrice');
    var editTotalShareAmountEl = document.getElementById('editTotalShareAmount');

    var shares = parseInt(editMemberSharesEl ? editMemberSharesEl.value : 1) || 1;
    var pricePerShare = parseInt(editSharePriceEl ? editSharePriceEl.value : 10) || 10;
    var total = shares * pricePerShare;
    
    if (editTotalShareAmountEl) editTotalShareAmountEl.textContent = formatCurrency(total);
}

/**
 * อัพเดท Select สมาชิก
 */
function updateMemberSelect() {
    var memberSelect = document.getElementById('memberSelect');
    if (!memberSelect) return;
    
    memberSelect.innerHTML = '<option value="">เลือกสมาชิก (ไม่บังคับ)</option>';
    members.forEach(function(member) {
        var option = document.createElement('option');
        option.value = member.id;
        option.textContent = `${member.student_id} - ${member.firstname} ${member.lastname} (${member.classroom})`;
        memberSelect.appendChild(option);
    });
}

/**
 * *** UPDATED: จัดการการแก้ไขสมาชิก ***
 */
async function handleUpdateMember(e) {
    e.preventDefault();
    showLoading('กำลังบันทึกการแก้ไข...');
    var memberData = {
        id: document.getElementById('editMemberId').value,
        student_id: document.getElementById('editMemberStudentId').value,
        firstname: document.getElementById('editMemberFirstname').value,
        lastname: document.getElementById('editMemberLastname').value,
        classroom: document.getElementById('editMemberClassroom').value,
        shares: parseInt(document.getElementById('editMemberShares').value)
    };
    
    try {
        var result = await apiCall('updateMember', memberData, sessionId);
        if (result.success) {
            showSuccess('แก้ไขสมาชิกเรียบร้อย');
            hideModal('editMemberModal');
            
            // Refresh data
            await loadMembers();
            await loadDashboardRefresh();
            loadMemberManagement();
        } else {
            showError(result.message || 'ไม่สามารถแก้ไขสมาชิกได้');
        }
    } catch (error) {
        console.error('Update member error:', error);
        showError('เกิดข้อผิดพลาดในการแก้ไขสมาชิก');
    }
    hideLoading();
}

/**
 * ลบสมาชิก
 */
async function deleteMember(memberId, memberName) {
    try {
        var confirmed = await Swal.fire({
            title: 'ยืนยันการลบสมาชิก',
            text: `ต้องการลบสมาชิก "${memberName}" ใช่หรือไม่?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ลบสมาชิก',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280'
        });
        
        if (confirmed.isConfirmed) {
            showLoading('กำลังลบสมาชิก...');
            var result = await apiCall('deleteMember', { id: memberId }, sessionId);
            if (result.success) {
                showSuccess('ลบสมาชิกเรียบร้อย');
                
                // Refresh data
                await loadMembers();
                await loadDashboardRefresh();
                loadMemberManagement();
            } else {
                showError(result.message || 'ไม่สามารถลบสมาชิกได้');
            }
            hideLoading();
        }
    } catch (error) {
        console.error('Delete member error:', error);
        showError('เกิดข้อผิดพลาดในการลบสมาชิก');
        hideLoading();
    }
}

/**
 * แก้ไขสมาชิก - เปิด Modal
 */
function editMember(memberId) {
    var member = members.find(m => m.id === memberId);
    if (!member) {
        showError('ไม่พบข้อมูลสมาชิก');
        return;
    }
    
    editingMember = member;
    
    var editMemberIdEl = document.getElementById('editMemberId');
    var editMemberStudentIdEl = document.getElementById('editMemberStudentId');
    var editMemberFirstnameEl = document.getElementById('editMemberFirstname');
    var editMemberLastnameEl = document.getElementById('editMemberLastname');
    var editMemberClassroomEl = document.getElementById('editMemberClassroom');
    var editMemberSharesEl = document.getElementById('editMemberShares');
    var editSharePriceEl = document.getElementById('editSharePrice');
    
    if (editMemberIdEl) editMemberIdEl.value = member.id;
    if (editMemberStudentIdEl) editMemberStudentIdEl.value = member.student_id;
    if (editMemberFirstnameEl) editMemberFirstnameEl.value = member.firstname;
    if (editMemberLastnameEl) editMemberLastnameEl.value = member.lastname;
    if (editMemberClassroomEl) editMemberClassroomEl.value = member.classroom;
    if (editMemberSharesEl) editMemberSharesEl.value = member.shares;
    if (editSharePriceEl) editSharePriceEl.value = member.share_price;
    
    calculateEditShareAmount();
    showModal('editMemberModal');
}

async function loadMemberManagement() {
    showLoading('กำลังโหลดข้อมูลสมาชิก...');
    
    try {
        if (typeof updateMemberSummary === 'function') {
            await updateMemberSummary();
        }
        
        var container = document.getElementById('memberManagementList');
        if (!container) {
            hideLoading();
            return;
        }
        
        container.innerHTML = '';
        
        var filtered = members.filter(m => {
            var searchInput = document.getElementById('memberSearchInput');
            var searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
            var name = `${m.firstname} ${m.lastname}`;
            return !searchTerm || name.toLowerCase().includes(searchTerm) || 
                   m.student_id.toLowerCase().includes(searchTerm) || 
                   m.classroom.toLowerCase().includes(searchTerm);
        });

        if (filtered.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center">ไม่พบสมาชิก</p>';
            hideLoading();
            return;
        }
        
        filtered.forEach(function(member) {
            var memberDividend = 0;
            if (window.profitSharingData && window.profitSharingData.dividendPerShare) {
                memberDividend = member.shares * window.profitSharingData.dividendPerShare;
            }
            
            var memberDiv = document.createElement('div');
            memberDiv.className = 'bg-white border rounded-lg p-4 hover:bg-gray-50 transition';
            memberDiv.innerHTML = `
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div class="flex items-center space-x-4 flex-1">
                        <div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <i class="fas fa-user text-purple-600"></i>
                        </div>
                        <div class="flex-1">
                            <h4 class="font-medium text-gray-900">${member.firstname} ${member.lastname}</h4>
                            <p class="text-sm text-gray-500">รหัส: ${member.student_id} • ห้อง: ${member.classroom}</p>
                            <p class="text-sm text-green-600">${member.shares} หุ้น • ${formatCurrency(member.total_amount)}</p>
                            <p class="text-xs text-gray-400">เข้าร่วม: ${formatDate(member.join_date)}</p>
                        </div>
                    </div>
                    <div class="flex flex-col sm:items-end gap-2 sm:gap-3">
                        <div class="text-right">
                            <p class="text-xs text-gray-500">ปันผล</p>
                            <p class="text-lg font-bold text-purple-600">${formatCurrency(memberDividend)}</p>
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="editMember('${member.id}')" class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm flex items-center space-x-1">
                                <i class="fas fa-edit"></i>
                                <span>แก้ไข</span>
                            </button>
                            <button onclick="deleteMember('${member.id}', '${member.firstname} ${member.lastname}')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm flex items-center space-x-1">
                                <i class="fas fa-trash"></i>
                                <span>ลบ</span>
                            </button>
                        </div>
                    </div>
                </div>`;
            container.appendChild(memberDiv);
        });
        
    } catch (error) {
        console.error('Error loading member management:', error);
        showError('เกิดข้อผิดพลาดในการโหลดข้อมูลสมาชิก');
    } finally {
        hideLoading();
    }
}


/**
 * *** NEW: อัพเดทสรุปรายได้สมาชิก (Profit Sharing) ***
 */

/**
 * *** NEW: คำนวณสรุปสมาชิกจากข้อมูล Local ***
 */
function calculateMemberSummaryLocally() {
    // คำนวณจากข้อมูล members ในเมมโมรี่
    let totalShares = 0;
    let memberCount = 0;
    
    if (window.members && Array.isArray(window.members)) {
        members.forEach(function(m) {
            if (m && m.status !== 'inactive') {
                totalShares += parseInt(m.shares || 0);
                memberCount++;
            }
        });
    }
    
    // อัพเดท UI สำหรับจำนวนสมาชิก
    const elements = {
        'memberSummaryCount': memberCount + ' คน',
        'memberSummaryTotalShares': totalShares + ' หุ้น'
    };
    
    for (const elementId in elements) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = elements[elementId];
        }
    }
    
    // เก็บไว้สำหรับใช้ในที่อื่น
    if (!window.profitSharingData) {
        window.profitSharingData = {};
    }
    window.profitSharingData.totalShares = totalShares;
    window.profitSharingData.memberCount = memberCount;
}

async function updateMemberSummary() {
    try {
        // เรียก API เพื่อดึงข้อมูลปันผล
        const result = await apiCall('getProfitSharingReport', {}, sessionId);
        
        if (!result.success) {
            // ถ้า API error ให้คำนวณจากข้อมูล members ในเมมโมรี่
            console.log('Calculating from local members data');
            calculateMemberSummaryLocally();
            return;
        }
        
        if (!result.summary) {
            console.log('No profit data yet');
            calculateMemberSummaryLocally();
            return;
        }
        
        const summary = result.summary;
        
        // อัพเดท UI
        const elements = {
            'memberSummaryTotalSales': formatCurrency(summary.totalSales || 0),
            'memberSummaryTotalCost': formatCurrency(summary.totalCost || 0),
            'memberSummaryProfit': formatCurrency(summary.netProfit || 0),
            'memberSummaryPerShare': summary.dividendPerShare > 0 ? formatCurrency(summary.dividendPerShare) : '฿0',
            'memberSummaryCount': (summary.memberCount || 0) + ' คน',
            'memberSummaryTotalShares': (summary.totalShares || 0) + ' หุ้น',
            'memberSummaryTotalDividend': formatCurrency(summary.netProfit || 0)
        };
        
        for (const elementId in elements) {
            const el = document.getElementById(elementId);
            if (el) {
                el.textContent = elements[elementId];
            }
        }
        
        // เก็บข้อมูลไว้ใน global variable
        window.profitSharingData = {
            totalSales: summary.totalSales,
            totalCost: summary.totalCost,
            profit: summary.profit,
            operatingCost: summary.operatingCost,
            netProfit: summary.netProfit,
            totalShares: summary.totalShares,
            memberCount: summary.memberCount,
            dividendPerShare: summary.dividendPerShare,
            memberDividends: result.members || []
        };
        
    } catch (error) {
        console.error('Error updating member summary:', error);
        // ถ้าเกิด error ให้แสดง 0 เป็นค่าเริ่มต้น
        const defaultElements = {
            'memberSummaryTotalSales': '฿0',
            'memberSummaryTotalCost': '฿0',
            'memberSummaryProfit': '฿0',
            'memberSummaryPerShare': '฿0',
            'memberSummaryCount': '0 คน',
            'memberSummaryTotalShares': '0 หุ้น',
            'memberSummaryTotalDividend': '฿0'
        };
        
        for (const elementId in defaultElements) {
            const el = document.getElementById(elementId);
            if (el) {
                el.textContent = defaultElements[elementId];
            }
        }
    }
}

/**
 * *** UPDATED: กรองสมาชิก (หน้าจัดการ) ***
 */
function filterMembers() {
    loadMemberManagement();
}


// ===== User Management (NEW) =====

/**
 * *** NEW: โหลดหน้าจัดการผู้ใช้งาน ***
 */
async function loadUsersManagement() {
    // ✅ ตรวจสอบว่ายังคงอยู่ที่หน้า manageUsersPage หรือไม่
    if (currentPageId !== 'manageUsersPage') {
        return;
    }
    
    if (!currentUser || currentUser.role !== 'admin') {
        showError('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
        if (typeof showDashboard === 'function') showDashboard();
        return;
    }
    
    showLoading('กำลังโหลดข้อมูลผู้ใช้งาน...');
    
    try {
        // รอให้ loading แสดง
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // ตรวจสอบอีกครั้ง
        if (currentPageId !== 'manageUsersPage') {
            hideLoading();
            return;
        }
        
        var container = document.getElementById('userManagementList');
        if (!container) {
            hideLoading();
            return;
        }
        
        container.innerHTML = '';

        if (users.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center">ไม่พบผู้ใช้งาน</p>';
            hideLoading();
            return;
        }
        
        users.forEach(function(user) {
            var userDiv = document.createElement('div');
            userDiv.className = 'bg-white border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50';
            var statusClass = user.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            var statusText = user.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน';

            userDiv.innerHTML = `
                <div class="flex items-center space-x-4">
                    <div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                        <i class="fas fa-user-shield text-indigo-600"></i>
                    </div>
                    <div>
                        <h4 class="font-medium text-gray-900">${user.name}</h4>
                        <p class="text-sm text-gray-500">Username: ${user.username} • Role: ${user.role}</p>
                        <p class="text-xs text-gray-400">Login ล่าสุด: ${user.last_login ? formatDate(user.last_login) : 'ยังไม่เคย Login'}</p>
                        <span class="${statusClass} text-xs px-2 py-0.5 rounded-full">${statusText}</span>
                    </div>
                </div>
                <div class="flex space-x-2">
                    <button onclick="editUser('${user.id}')" class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm flex items-center space-x-1">
                        <i class="fas fa-edit"></i>
                        <span>แก้ไข</span>
                    </button>
                    ${currentUser.id !== user.id ? // Prevent deleting self
                    `<button onclick="deleteUser('${user.id}', '${user.name}')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm flex items-center space-x-1">
                        <i class="fas fa-trash"></i>
                        <span>ลบ</span>
                    </button>` : ''}
                </div>`;
            container.appendChild(userDiv);
        });
        
        // รอให้ DOM render เสร็จ
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                setTimeout(resolve, 100);
            });
        });
    } catch (error) {
        console.error('Error loading users management:', error);
        showError('เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้งาน');
    } finally {
        hideLoading();
    }
}

/**
 * *** NEW: จัดการการเพิ่มผู้ใช้งาน ***
 */
async function handleAddUser(e) {
    e.preventDefault();
    var userData = {
        name: document.getElementById('addUserName').value,
        username: document.getElementById('addUserUsername').value,
        password: document.getElementById('addUserPassword').value,
        role: document.getElementById('addUserRole').value
    };
    
    if (!userData.username || !userData.password || !userData.role) {
        showError('กรุณากรอกข้อมูลที่จำเป็น');
        return;
    }
    
    showLoading();
    try {
        var result = await apiCall('addUser', userData, sessionId);
        if (result.success) {
            showSuccess('เพิ่มผู้ใช้งานเรียบร้อย');
            hideModal('addUserModal');
            resetForm('addUserForm');
            
            await loadUsers();
            loadUsersManagement();
        } else {
            showError(result.message || 'ไม่สามารถเพิ่มผู้ใช้งานได้');
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการเพิ่มผู้ใช้งาน');
    }
    hideLoading();
}

/**
 * *** NEW: จัดการการแก้ไขผู้ใช้งาน ***
 */
async function handleUpdateUser(e) {
    e.preventDefault();
    var userData = {
        id: document.getElementById('editUserId').value,
        name: document.getElementById('editUserName').value,
        password: document.getElementById('editUserPassword').value, // (ว่างได้)
        role: document.getElementById('editUserRole').value,
        active: document.getElementById('editUserActive').checked
    };

    showLoading();
    try {
        var result = await apiCall('updateUser', userData, sessionId);
        if (result.success) {
            showSuccess('แก้ไขผู้ใช้งานเรียบร้อย');
            hideModal('editUserModal');
            
            await loadUsers();
            loadUsersManagement();
        } else {
            showError(result.message || 'ไม่สามารถแก้ไขผู้ใช้งานได้');
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการแก้ไขผู้ใช้งาน');
    }
    hideLoading();
}

/**
 * *** NEW: แก้ไขผู้ใช้งาน - เปิด Modal ***
 */
function editUser(userId) {
    var user = users.find(u => u.id === userId);
    if (!user) {
        showError('ไม่พบข้อมูลผู้ใช้งาน');
        return;
    }
    
    editingUser = user;
    
    var editUserIdEl = document.getElementById('editUserId');
    var editUserNameEl = document.getElementById('editUserName');
    var editUserUsernameEl = document.getElementById('editUserUsername');
    var editUserRoleEl = document.getElementById('editUserRole');
    var editUserActiveEl = document.getElementById('editUserActive');
    var editUserPasswordEl = document.getElementById('editUserPassword');

    if (editUserIdEl) editUserIdEl.value = user.id;
    if (editUserNameEl) editUserNameEl.value = user.name;
    if (editUserUsernameEl) editUserUsernameEl.value = user.username;
    if (editUserRoleEl) editUserRoleEl.value = user.role;
    if (editUserActiveEl) editUserActiveEl.checked = user.active;
    if (editUserPasswordEl) editUserPasswordEl.value = ''; // Clear password field
    
    showModal('editUserModal');
}

/**
 * *** NEW: ลบผู้ใช้งาน ***
 */
async function deleteUser(userId, userName) {
    if (currentUser.id === userId) {
        showError('คุณไม่สามารถลบตัวเองได้');
        return;
    }
    
    try {
        var confirmed = await Swal.fire({
            title: 'ยืนยันการลบผู้ใช้งาน',
            text: `ต้องการลบ "${userName}" ใช่หรือไม่?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ลบ',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280'
        });
        
        if (confirmed.isConfirmed) {
            showLoading('กำลังลบผู้ใช้งาน...');
            var result = await apiCall('deleteUser', { id: userId }, sessionId);
            if (result.success) {
                showSuccess('ลบผู้ใช้งานเรียบร้อย');
                await loadUsers();
                loadUsersManagement();
            } else {
                showError(result.message || 'ไม่สามารถลบผู้ใช้งานได้');
            }
            hideLoading();
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการลบผู้ใช้งาน');
        hideLoading();
    }
}


// ===== Sales Management - Drive Folder =====

/**
 * NEW: สร้าง Folder ใน Google Drive (หากยังไม่มี)
 */
async function handleCreateDriveFolder() {
    try {
        var confirmed = await Swal.fire({
            title: 'สร้างโฟลเดอร์ใน Google Drive?',
            text: 'ระบบจะสร้างโฟลเดอร์ใหม่สำหรับเก็บรูปภาพสินค้าและ QR Code (หากยังไม่มี)',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'สร้างเลย',
            cancelButtonText: 'ยกเลิก',
        });

        if (confirmed.isConfirmed) {
            showLoading();
            var result = await apiCall('createImageFolder', {}, sessionId); 
            
            if (result.success) {
                showSuccess('สร้างโฟลเดอร์เรียบร้อยแล้ว');
                var settingDriveFolderIdEl = document.getElementById('settingDriveFolderId');
                var createDriveFolderBtnEl = document.getElementById('createDriveFolderBtn');
                
                if (settingDriveFolderIdEl) settingDriveFolderIdEl.value = result.folderId;
                if (createDriveFolderBtnEl) createDriveFolderBtnEl.classList.add('hidden');
                
                systemConfig.drive_folder_id = result.folderId; // อัพเดท config ใน client
            } else {
                showError(result.message || 'ไม่สามารถสร้างโฟลเดอร์ได้');
            }
            hideLoading();
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาด: ' + error.message);
        hideLoading();
    }
}

// ===== Shopping Cart =====

/**
 * เพิ่มสินค้าในตะกร้า
 */
function addToCart(product) {
    if (product.stock <= 0) {
        showErrorToast('สินค้าหมด');
        return;
    }
    
    var existingItem = currentCart.find(item => item.product_id === product.id);
    
    if (existingItem) {
        if (existingItem.quantity >= product.stock) {
            showWarningToast('ไม่สามารถเพิ่มได้เพราะสินค้าไม่เพียงพอ');
            return;
        }
        existingItem.quantity += 1;
    } else {
        currentCart.push({
            product_id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            unit: product.unit,
            max_stock: product.stock
        });
    }
    
    updateCartDisplay();
    updateCheckoutButton();
    showSuccessToast('เพิ่ม ' + product.name + ' แล้ว');
}

/**
 * ลบสินค้าจากตะกร้า
 */
function removeFromCart(productId) {
    currentCart = currentCart.filter(item => item.product_id !== productId);
    updateCartDisplay();
    updateCheckoutButton();
}

/**
 * เปลี่ยนจำนวนสินค้าในตะกร้า
 */
function updateCartQuantity(productId, quantity) {
    var item = currentCart.find(item => item.product_id === productId);
    if (item) {
        if (quantity <= 0) {
            removeFromCart(productId);
        } else if (quantity <= item.max_stock) {
            item.quantity = quantity;
            updateCartDisplay();
            updateCheckoutButton();
        } else {
            showErrorToast('จำนวนเกินสินค้าที่มีในสต็อก');
            // Reset input value if it's from direct input
            var inputEl = document.querySelector(`input[data-id='${productId}']`);
            if (inputEl) inputEl.value = item.max_stock;
        }
    }
}

/**
 * ล้างตะกร้า
 */
function clearCart() {
    currentCart = [];
    updateCartDisplay();
    updateCheckoutButton();
}

/**
 * อัพเดทการแสดงผลตะกร้า
 */
function updateCartDisplay() {
    var cartItems = document.getElementById('cartItems');
    var totalAmount = document.getElementById('totalAmount');
    
    if (!cartItems || !totalAmount) return; // Guard clause
    
    if (currentCart.length === 0) {
        cartItems.innerHTML = '<div class="text-center py-8"><i class="fas fa-shopping-cart text-4xl text-gray-300 mb-4"></i><p class="text-gray-500">ไม่มีสินค้าในตะกร้า</p></div>';
        totalAmount.textContent = formatCurrency(0);
        calculateChange();
        return;
    }
    
    var total = 0;
    cartItems.innerHTML = '';
    
    currentCart.forEach(function(item) {
        var itemTotal = item.price * item.quantity;
        total += itemTotal;
        
        var cartItemDiv = document.createElement('div');
        cartItemDiv.className = 'cart-item bg-white border rounded-lg p-3 animate-fadeIn';
        
        var minusDisabled = item.quantity <= 1 ? 'disabled' : '';
        var plusDisabled = item.quantity >= item.max_stock ? 'disabled' : '';

        cartItemDiv.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex-1">
                    <h4 class="font-medium text-gray-900">${item.name}</h4>
                    <p class="text-sm text-gray-500">${formatCurrency(item.price)} x ${item.unit}</p>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="updateCartQuantity('${item.product_id}', ${item.quantity - 1})" 
                    class="w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center transition-all hover:scale-110" ${minusDisabled}>
                        <i class="fas fa-minus text-xs"></i>
                    </button>
                    <span class="w-8 text-center font-medium">${item.quantity}</span>
                    <button onclick="updateCartQuantity('${item.product_id}', ${item.quantity + 1})" 
                    class="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center transition-all hover:scale-110" ${plusDisabled}>
                        <i class="fas fa-plus text-xs"></i>
                    </button>
                    <button onclick="removeFromCart('${item.product_id}')" 
                    class="ml-2 text-red-500 hover:text-red-700 p-1 rounded transition-all hover:bg-red-50">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
            </div>
            <div class="text-right mt-2">
                <span class="font-bold text-green-600">${formatCurrency(itemTotal)}</span>
            </div>`;
        cartItems.appendChild(cartItemDiv);
    });
    
    totalAmount.textContent = formatCurrency(total);
    calculateChange();
}

/**
 * อัพเดทปุ่มชำระเงิน
 */
function updateCheckoutButton() {
    var checkoutBtn = document.getElementById('checkoutBtn');
    if (!checkoutBtn) return;
    
    var total = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    if (currentCart.length === 0) {
        checkoutBtn.disabled = true;
        return;
    }
    
    if (paymentMethod === 'cash') {
        var received = parseFloat(document.getElementById('receivedAmount').value) || 0;
        checkoutBtn.disabled = received < total;
    } else {
        checkoutBtn.disabled = false;
    }
}

/**
 * เลือกวิธีชำระเงิน
 */
function selectPaymentMethod(method) {
    paymentMethod = method;
    
    document.querySelectorAll('.payment-method').forEach(function(btn) {
        btn.classList.remove('selected', 'border-blue-500', 'bg-blue-50');
        btn.classList.add('border-gray-300');
    });
    
    var selectedBtn = document.querySelector(`[data-method="${method}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('selected', 'border-blue-500', 'bg-blue-50');
        selectedBtn.classList.remove('border-gray-300');
    }
    
    var cashDetailsEl = document.getElementById('cashDetails');
    var promptpayDetailsEl = document.getElementById('promptpayDetails');
    
    if (cashDetailsEl) cashDetailsEl.classList.add('hidden');
    if (promptpayDetailsEl) promptpayDetailsEl.classList.add('hidden');
    
    if (method === 'cash') {
        if (cashDetailsEl) cashDetailsEl.classList.remove('hidden');
        calculateChange();
    } else if (method === 'promptpay') {
        if (promptpayDetailsEl) promptpayDetailsEl.classList.remove('hidden');
        generatePromptPayQR();
    }
    
    updateCheckoutButton();
}

/**
 * คำนวณเงินทอน
 */
function calculateChange() {
    if (paymentMethod !== 'cash') return;
    
    var total = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    var receivedEl = document.getElementById('receivedAmount');
    var changeAmountEl = document.getElementById('changeAmount');

    var received = parseFloat(receivedEl ? receivedEl.value : 0) || 0;
    var change = received - total;
    
    if (!changeAmountEl) return;

    if (change >= 0) {
        changeAmountEl.value = formatCurrency(change);
        changeAmountEl.classList.remove('text-red-500');
    } else {
        changeAmountEl.value = 'ไม่พอ ' + formatCurrency(Math.abs(change));
        changeAmountEl.classList.add('text-red-500');
    }
    
    updateCheckoutButton();
}

/**
 * สร้าง QR Code สำหรับพร้อมเพย์
 */
function generatePromptPayQR() {
    var total = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    var promptpayName = systemConfig.promptpay_name || 'ร้านค้าสหกรณ์';
    var promptpayQRUrl = systemConfig.promptpay_qr_url;
    
    var qrImage = document.getElementById('promptpayQRImage');
    var qrPlaceholder = document.getElementById('promptpayPlaceholder');
    var qrInfo = document.getElementById('promptpayInfo');

    if (!qrImage || !qrPlaceholder || !qrInfo) return; // Guard clause
    
    if (promptpayQRUrl) {
        qrImage.src = promptpayQRUrl;
        qrImage.style.display = 'block';
        qrPlaceholder.style.display = 'none';
        
        qrInfo.innerHTML = `
            <p><strong>ชื่อบัญชี:</strong> ${promptpayName}</p>
            <p><strong>จำนวนเงิน:</strong> ${formatCurrency(total)}</p>
            <p class="text-sm text-gray-500 mt-2">กรุณาสแกน QR Code และระบุจำนวนเงิน</p>`;
    } else {
        qrImage.style.display = 'none';
        qrPlaceholder.style.display = 'flex';
        
        qrInfo.innerHTML = `
            <p class="text-red-500">ยังไม่ได้ตั้งค่า QR Code พร้อมเพย์</p>
            <p class="text-sm text-gray-500">กรุณาไปที่การตั้งค่าเพื่ออัพโหลด QR Code</p>`;
    }
}

// ===== Settings Management =====

/**
 * โหลดการตั้งค่า
 */
async function loadSettings() {
    try {
        var result = await apiCall('getConfig', {}, sessionId);
        if (result.success) {
            var config = result.config;
            var settingAppNameEl = document.getElementById('settingAppName');
            var settingSharePriceEl = document.getElementById('settingSharePrice');
            var settingBarcodePrefixEl = document.getElementById('settingBarcodePrefix');
            var settingReceiptFooterEl = document.getElementById('settingReceiptFooter');
            var settingPromptpayNumberEl = document.getElementById('settingPromptpayNumber');
            var settingPromptpayNameEl = document.getElementById('settingPromptpayName');
            var settingBankAccountEl = document.getElementById('settingBankAccount');
            var settingBankNameEl = document.getElementById('settingBankName');
            var settingEnableCashChangeEl = document.getElementById('settingEnableCashChange');
            var settingPromptpayQRUrlEl = document.getElementById('settingPromptpayQRUrl');
            var settingDriveFolderIdEl = document.getElementById('settingDriveFolderId');
            var createDriveFolderBtnEl = document.getElementById('createDriveFolderBtn');
            var promptpayQRPreviewImgEl = document.getElementById('promptpayQRPreviewImg');
            var promptpayQRPreviewEl = document.getElementById('promptpayQRPreview');


            if (settingAppNameEl) settingAppNameEl.value = config.app_name || '';
            if (settingSharePriceEl) settingSharePriceEl.value = config.share_price || 10;
            if (settingBarcodePrefixEl) settingBarcodePrefixEl.value = config.barcode_prefix || 'SCH';
            if (settingReceiptFooterEl) settingReceiptFooterEl.value = config.receipt_footer || '';
            if (settingPromptpayNumberEl) settingPromptpayNumberEl.value = config.promptpay_number || '';
            if (settingPromptpayNameEl) settingPromptpayNameEl.value = config.promptpay_name || '';
            if (settingBankAccountEl) settingBankAccountEl.value = config.bank_account || '';
            if (settingBankNameEl) settingBankNameEl.value = config.bank_name || '';
            if (settingEnableCashChangeEl) settingEnableCashChangeEl.checked = config.enable_cash_change !== false;
            if (settingPromptpayQRUrlEl) settingPromptpayQRUrlEl.value = config.promptpay_qr_url || '';
            
            if (settingDriveFolderIdEl) settingDriveFolderIdEl.value = config.drive_folder_id || '';
            
            if (createDriveFolderBtnEl) {
                if (config.drive_folder_id) {
                    createDriveFolderBtnEl.classList.add('hidden'); // ซ่อนปุ่มถ้ามี ID แล้ว
                } else {
                    createDriveFolderBtnEl.classList.remove('hidden'); // แสดงปุ่มถ้ายังไม่มี ID
                }
            }


            if (config.promptpay_qr_url) {
                if (promptpayQRPreviewImgEl) promptpayQRPreviewImgEl.src = config.promptpay_qr_url;
                if (promptpayQRPreviewEl) promptpayQRPreviewEl.classList.remove('hidden');
            } else {
                if (promptpayQRPreviewEl) promptpayQRPreviewEl.classList.add('hidden');
            }
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการโหลดการตั้งค่า');
    }
}

/**
 * อัพเดทการตั้งค่า
 */
async function handleUpdateSettings(e) {
    e.preventDefault();
    var promptpayQRUrl = document.getElementById('settingPromptpayQRUrl').value;
    var qrInput = document.getElementById('promptpayQRInput');
    
    if (qrInput.files && qrInput.files[0]) {
        showLoading();
        var uploadResult = await uploadProductImage(qrInput.files[0]);
        if (!uploadResult.success) {
            hideLoading();
            showError('ไม่สามารถอัพโหลด QR Code ได้: ' + uploadResult.message);
            return;
        }
        promptpayQRUrl = uploadResult.imageUrl;
        hideLoading();
    }
    
    var settingAppNameEl = document.getElementById('settingAppName');
    var settingSharePriceEl = document.getElementById('settingSharePrice');
    var settingBarcodePrefixEl = document.getElementById('settingBarcodePrefix');
    var settingReceiptFooterEl = document.getElementById('settingReceiptFooter');
    var settingPromptpayNumberEl = document.getElementById('settingPromptpayNumber');
    var settingPromptpayNameEl = document.getElementById('settingPromptpayName');
    var settingBankAccountEl = document.getElementById('settingBankAccount');
    var settingBankNameEl = document.getElementById('settingBankName');
    var settingEnableCashChangeEl = document.getElementById('settingEnableCashChange');
    var settingDriveFolderIdEl = document.getElementById('settingDriveFolderId');
    
    var configData = {
        app_name: settingAppNameEl ? settingAppNameEl.value : '',
        share_price: parseInt(settingSharePriceEl ? settingSharePriceEl.value : 10),
        barcode_prefix: settingBarcodePrefixEl ? settingBarcodePrefixEl.value : 'SCH',
        receipt_footer: settingReceiptFooterEl ? settingReceiptFooterEl.value : '',
        promptpay_number: settingPromptpayNumberEl ? settingPromptpayNumberEl.value : '',
        promptpay_name: settingPromptpayNameEl ? settingPromptpayNameEl.value : '',
        promptpay_qr_url: promptpayQRUrl,
        bank_account: settingBankAccountEl ? settingBankAccountEl.value : '',
        bank_name: settingBankNameEl ? settingBankNameEl.value : '',
        enable_cash_change: settingEnableCashChangeEl ? settingEnableCashChangeEl.checked : true,
        drive_folder_id: settingDriveFolderIdEl ? settingDriveFolderIdEl.value.trim() : '' 
    };
    
    showLoading();
    try {
        var result = await apiCall('updateConfig', configData, sessionId);
        if (result.success) {
            systemConfig = result.config;
            showSuccess('อัพเดทการตั้งค่าเรียบร้อย');
            
            // Update UI globally
            updateAppUI(systemConfig); 

            showDashboard(); // Back to dashboard
            
            var sharePriceEl = document.getElementById('sharePrice');
            if (sharePriceEl) sharePriceEl.value = systemConfig.share_price || 10;
            calculateShareAmount();
        } else {
            showError(result.message || 'ไม่สามารถอัพเดทการตั้งค่าได้');
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการอัพเดทการตั้งค่า');
    }
    hideLoading();
}

// ===== Barcode Scanner =====

/**
 * เริ่มสแกนบาร์โค้ด
 */
function startScanning() {
    if (isScanning) return;
    try {
        var qrReaderElement = document.getElementById('qr-reader');
        if (!qrReaderElement) return;
        qrReaderElement.classList.remove('hidden');
        
        html5QrCode = new Html5Qrcode("qr-reader");
        
        var config = { fps: 10, qrbox: { width: 250, height: 250 } };
        
        html5QrCode.start(
            { facingMode: "environment" }, config,
            (decodedText, decodedResult) => {
                var manualBarcodeEl = document.getElementById('manualBarcode');
                if (manualBarcodeEl) manualBarcodeEl.value = decodedText;
                searchByBarcode();
                stopScanning();
            },
            (errorMessage) => { /* console.log(errorMessage); */ }
        ).then(() => {
            isScanning = true;
            var startScanBtnEl = document.getElementById('startScanBtn');
            var stopScanBtnEl = document.getElementById('stopScanBtn');
            if (startScanBtnEl) startScanBtnEl.classList.add('hidden');
            if (stopScanBtnEl) stopScanBtnEl.classList.remove('hidden');

        }).catch(err => {
            showError('ไม่สามารถเปิดกล้องได้');
            if (qrReaderElement) qrReaderElement.classList.add('hidden');
        });
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการเริ่มสแกน');
    }
}

/**
 * หยุดสแกนบาร์โค้ด
 */
function stopScanning() {
    var qrReaderEl = document.getElementById('qr-reader');
    var startScanBtnEl = document.getElementById('startScanBtn');
    var stopScanBtnEl = document.getElementById('stopScanBtn');

    if (html5QrCode && isScanning) {
        html5QrCode.stop().then(() => {
            isScanning = false;
            if (qrReaderEl) qrReaderEl.classList.add('hidden');
            if (startScanBtnEl) startScanBtnEl.classList.remove('hidden');
            if (stopScanBtnEl) stopScanBtnEl.classList.add('hidden');
        }).catch(err => {
            console.error('Error stopping scanner:', err);
        });
    }
}

/**
 * ค้นหาสินค้าด้วยบาร์โค้ด
 */
async function searchByBarcode() {
    var manualBarcodeEl = document.getElementById('manualBarcode');
    var barcode = manualBarcodeEl ? manualBarcodeEl.value.trim() : '';

    if (!barcode) {
        showError('กรุณากรอกบาร์โค้ด');
        return;
    }
    
    showLoading();
    try {
        var result = await apiCall('findProductByBarcode', { barcode: barcode }, sessionId);
        if (result.success) {
            addToCart(result.product);
            if (manualBarcodeEl) manualBarcodeEl.value = '';
        } else {
            showError('ไม่พบสินค้าที่มีบาร์โค้ดนี้');
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการค้นหาสินค้า');
    }
    hideLoading();
}

// ===== Checkout Process (Fixed Loading State) =====

/**
 * จัดการการชำระเงิน
 */
async function handleCheckout() {
    if (currentCart.length === 0) {
        showError('ไม่มีสินค้าในตะกร้า');
        return;
    }
    
    var memberSelectEl = document.getElementById('memberSelect');
    var receivedAmountEl = document.getElementById('receivedAmount');

    var selectedMemberId = memberSelectEl ? memberSelectEl.value || null : null;
    var total = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    var receivedAmount = 0;
    var changeAmount = 0;
    
    if (paymentMethod === 'cash') {
        receivedAmount = parseFloat(receivedAmountEl ? receivedAmountEl.value : 0) || 0;
        changeAmount = receivedAmount - total;
        if (changeAmount < 0) {
            showError('เงินที่ได้รับไม่เพียงพอ');
            return;
        }
    }
    
    var saleData = {
        items: currentCart,
        member_id: selectedMemberId,
        payment_method: paymentMethod,
        received_amount: receivedAmount,
        change_amount: changeAmount,
        discount: 0,
        notes: ''
    };
    
    var paymentMethodText = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอนเงิน' };
    var confirmText = `
        <div class="text-left">
            <p><strong>จำนวน:</strong> ${currentCart.length} รายการ</p>
            <p><strong>ยอดรวม:</strong> ${formatCurrency(total)}</p>
            <p><strong>วิธีชำระ:</strong> ${paymentMethodText[paymentMethod]}</p>
            ${paymentMethod === 'cash' ? `
            <p><strong>เงินที่ได้รับ:</strong> ${formatCurrency(receivedAmount)}</p>
            <p><strong>เงินทอน:</strong> ${formatCurrency(changeAmount)}</p>` : ''}
        </div>`;
    
    var confirmed = await Swal.fire({
        title: 'ยืนยันการขาย',
        html: confirmText,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'ยืนยันการขาย',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#059669',
        cancelButtonColor: '#6b7280'
    });
    
    if (!confirmed.isConfirmed) return;
    
    showLoading();
    
    try {
        var result = await apiCall('processSale', saleData, sessionId);

        hideLoading(); 

        if (result.success) {
            await showSimpleReceipt(total, currentCart.length, result.receipt_number || 'N/A');
            await resetAfterSale();
        } else {
            showError(result.message || 'ไม่สามารถบันทึกการขายได้');
        }
    } catch (error) {
        console.error('Checkout error:', error);
        showError('เกิดข้อผิดพลาดร้ายแรง: ' + error.message);
        hideLoading(); // Ensure loading is hidden on catastrophic failure
    }
}

/**
 * ฟังก์ชันสำหรับสั่งพิมพ์เนื้อหา HTML (Fixed for Browser Compatibility)
 * @param {string} htmlContent - HTML content of the receipt (already styled)
 */
function printReceipt(htmlContent) {
    try {
        // 1. สร้าง iframe ชั่วคราว
        var printFrame = document.createElement('iframe');
        printFrame.style.position = 'fixed';
        printFrame.style.top = '0';
        printFrame.style.left = '0';
        printFrame.style.width = '100%';
        printFrame.style.height = '100%';
        printFrame.style.border = 'none';
        printFrame.style.zIndex = '9999';
        printFrame.style.display = 'none'; // ✅ ซ่อน iframe
        document.body.appendChild(printFrame);
        
        var frameDoc = printFrame.contentWindow || printFrame.contentDocument;
        if (frameDoc.document) frameDoc = frameDoc.document;
        
        frameDoc.open();
        
        // 2. ใส่เนื้อหาและสไตล์ 
        frameDoc.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <title>ใบเสร็จรับเงิน</title>
                    <style>
                        @media print {
                            @page { 
                                size: 80mm auto; 
                                margin: 0; 
                            }
                        }
                        body { 
                            font-family: 'monospace', 'Courier New', monospace; 
                            margin: 0; 
                            padding: 10px; 
                            font-size: 12px; 
                            line-height: 1.4;
                        }
                        .receipt-content { 
                            max-width: 80mm; 
                            margin: 0 auto; 
                        }
                        * {
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                    </style>
                </head>
                <body>
                    <div class="receipt-content">
                        ${htmlContent}
                    </div>
                </body>
            </html>
        `);
        frameDoc.close();
        
        // 3. รอให้ iframe โหลดเสร็จแล้วค่อยสั่งพิมพ์
        printFrame.onload = function() {
            try {
                // ✅ ใช้ timeout เพื่อให้เบราว์เซอร์ render เสร็จก่อน
                setTimeout(function() {
                    printFrame.contentWindow.focus();
                    printFrame.contentWindow.print();
                    
                    // 4. ลบ iframe หลังจากพิมพ์เสร็จ (หรือกด Cancel)
                    setTimeout(function() {
                        if (document.body.contains(printFrame)) {
                            document.body.removeChild(printFrame);
                        }
                    }, 1000);
                }, 250); // รอ 250ms
                
            } catch (e) {
                console.error('Print error:', e);
                showError('เกิดข้อผิดพลาดในการสั่งพิมพ์: ' + e.message);
                if (document.body.contains(printFrame)) {
                    document.body.removeChild(printFrame);
                }
            }
        };

    } catch (error) {
        console.error('Print setup error:', error);
        showError('ไม่สามารถเตรียมการพิมพ์ได้: ' + error.message);
    }
}

/**
 * แสดงใบเสร็จอย่างง่าย (Updated with Print Button - Fixed)
 */
async function showSimpleReceipt(total, itemCount, receiptNumber) {
    var shopName = systemConfig.app_name || 'ร้านค้าสหกรณ์';
    var receiptFooter = systemConfig.receipt_footer || 'ขอบคุณที่ใช้บริการ';
    var now = new Date();
    
    var itemsHtml = currentCart.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; padding-bottom: 4px;">
            <div style="flex: 1;">
                <span style="font-weight: 500;">${item.name}</span>
                <div style="font-size: 11px; color: #555;">
                    ${formatCurrency(item.price)} × ${item.quantity} ${item.unit || 'ชิ้น'}
                </div>
            </div>
            <span style="font-weight: bold; color: #059669;">${formatCurrency(item.price * item.quantity)}</span>
        </div>
    `).join('');

    // สร้าง HTML สำหรับการแสดงผลใน SweetAlert2 และใช้สำหรับพิมพ์
    var detailedReceiptHtml = `
        <div style="font-family: monospace;">
            <div style="text-align: center; margin-bottom: 16px; border-bottom: 1px dashed #ccc; padding-bottom: 10px;">
                <h2 style="font-size: 18px; font-weight: bold; color: #1f2937; margin-bottom: 5px;">${shopName}</h2>
                <div style="font-size: 11px; color: #4b5563;">
                    <p style="margin: 0;">🧾 เลขที่: <span style="font-weight: bold; color: #2563eb;">${receiptNumber}</span></p>
                    <p style="margin: 0;">🕐 ${now.toLocaleDateString('th-TH')} ${now.toLocaleTimeString('th-TH')}</p>
                </div>
            </div>
            <div class="items-section">
                <h3 style="font-weight: bold; color: #374151; margin-bottom: 8px; text-align: center; font-size: 13px;">🛒 รายการสินค้า</h3>
                <div style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc; padding: 8px 0; margin-bottom: 10px; text-align: left;">${itemsHtml}</div>
            </div>
            <div style="background: #e0f2f1; border-radius: 4px; padding: 8px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="font-size: 16px; font-weight: bold; color: #374151;">💰 ยอดรวม:</span>
                    <span style="font-size: 20px; font-weight: bold; color: #059669;">${formatCurrency(total)}</span>
                </div>
            </div>
            <div style="text-align: center; border-top: 1px dashed #ccc; padding-top: 10px;">
                <p style="color: #4b5563; font-size: 12px; margin: 0;">${receiptFooter}</p>
            </div>
        </div>`;

    // ✅ แก้ไขตรงนี้: ใช้ customClass และ didOpen แทน preCancel
    var result = await Swal.fire({
        html: detailedReceiptHtml,
        showCancelButton: true,
        confirmButtonText: '📱 ปิด',
        cancelButtonText: '🖨️ พิมพ์',
        confirmButtonColor: '#059669',
        cancelButtonColor: '#3b82f6',
        width: '600px',
        reverseButtons: true,
        allowOutsideClick: false, // ป้องกันปิดโดยไม่ตั้งใจ
    });

    // ตรวจสอบว่าผู้ใช้กดปุ่มไหน
    if (result.dismiss === Swal.DismissReason.cancel) {
        // ✅ เรียก printReceipt หลังจาก Modal ปิดแล้ว (เป็น direct user action)
        printReceipt(detailedReceiptHtml);
    }
}

/**
 * รีเซ็ตหลังการขาย
 */
async function resetAfterSale() {
    clearCart();
    var memberSelectEl = document.getElementById('memberSelect');
    var receivedAmountEl = document.getElementById('receivedAmount');
    var changeAmountEl = document.getElementById('changeAmount');

    if (memberSelectEl) memberSelectEl.value = '';
    if (receivedAmountEl) receivedAmountEl.value = '';
    if (changeAmountEl) changeAmountEl.value = '';

    selectPaymentMethod('cash');
    
    // Refresh data in background (important for Dashboard updates)
    await loadProducts();
    await loadDashboardRefresh();
    
    showSuccess('บันทึกการขายเรียบร้อย');
}

// ===== Reports Functions =====

/**
 * โหลดรายงาน
 */
async function loadReport() {
    var reportPeriodEl = document.getElementById('reportPeriod');
    var reportDateEl = document.getElementById('reportDate');

    var period = reportPeriodEl ? reportPeriodEl.value : 'daily';
    var date = reportDateEl ? reportDateEl.value : new Date().toISOString().split('T')[0];
    
    if (!date) {
        showError('กรุณาเลือกวันที่');
        return;
    }
    
    showLoading();
    try {
        var result = await apiCall('getSalesReport', { period: period, date: date }, sessionId);
        if (result.success) {
            displayReport(result.report);
            var reportContentEl = document.getElementById('reportContent');
            var noReportDataEl = document.getElementById('noReportData');
            if (reportContentEl) reportContentEl.classList.remove('hidden');
            if (noReportDataEl) noReportDataEl.classList.add('hidden');
        } else {
            showError(result.message || 'ไม่สามารถสร้างรายงานได้');
        }
    } catch (error) {
        showError('เกิดข้อผิดพลาดในการโหลดรายงาน');
    }
    hideLoading();
}

/**
 * แสดงผลรายงาน
 */
function displayReport(report) {
    var reportTotalSalesEl = document.getElementById('reportTotalSales');
    var reportTotalTransactionsEl = document.getElementById('reportTotalTransactions');
    var reportAverageTransactionEl = document.getElementById('reportAverageTransaction');
    var reportTotalMembersEl = document.getElementById('reportTotalMembers');
    var topProductsListEl = document.getElementById('topProductsList');

    if (reportTotalSalesEl) reportTotalSalesEl.textContent = formatCurrency(report.summary.total_sales);
    if (reportTotalTransactionsEl) reportTotalTransactionsEl.textContent = report.summary.total_transactions;
    if (reportAverageTransactionEl) reportAverageTransactionEl.textContent = formatCurrency(report.summary.average_transaction);
    if (reportTotalMembersEl) reportTotalMembersEl.textContent = report.summary.active_members;
    
    if (!topProductsListEl) return; 

    topProductsListEl.innerHTML = '';
    
    if (report.top_products && report.top_products.length > 0) {
        report.top_products.forEach(function(product, i) {
            var productDiv = document.createElement('div');
            productDiv.className = 'top-product-item flex items-center justify-between p-3 bg-gray-50 rounded-lg border';
            productDiv.innerHTML = `
                <div class="flex items-center space-x-3">
                    <div class="product-rank w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">${i + 1}</div>
                    <div>
                        <h4 class="font-medium">${product.name}</h4>
                        <p class="text-sm text-gray-600">ขายได้ ${product.quantity} รายการ</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="font-bold text-green-600">${formatCurrency(product.revenue)}</p>
                </div>`;
            topProductsListEl.appendChild(productDiv);
        });
    } else {
        topProductsListEl.innerHTML = '<p class="text-gray-500 text-center">ไม่มีข้อมูลการขาย</p>';
    }
    
    createSalesChart(report.daily_sales || []);
}

/**
 * สร้างกราฟยอดขาย
 */
function createSalesChart(dailySales) {
    var canvas = document.getElementById('salesChart');
    var ctx = canvas ? canvas.getContext('2d') : null;
    
    if (!ctx) return;
    
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    
    var labels = dailySales.map(day => new Date(day.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    var amounts = dailySales.map(day => day.amount);
    
    salesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ยอดขาย (บาท)',
                data: amounts,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => '฿' + value.toLocaleString() }
                }
            },
            plugins: {
                title: { display: true, text: 'ยอดขายรายวัน' },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => 'ยอดขาย: ฿' + context.parsed.y.toLocaleString()
                    }
                }
            }
        }
    });
}


// ===== Utility Functions =====

/**
 * รายการ action ที่ใช้ GET (ข้อมูลทั่วไป, ไม่มี body ใหญ่)
 */
var GET_ACTIONS = ['logout', 'validateSession', 'getConfig', 'getProducts', 'getMembers', 'getUsers', 'getRecentSales', 'getSalesReport', 'getProfitSharingReport', 'findProductByBarcode', 'getProductImages'];

/**
 * เรียก API ผ่าน Fetch (GET สำหรับข้อมูลทั่วไป, POST สำหรับข้อมูลใหญ่)
 */
async function apiCall(action, data, sessionId) {
    data = data || {};
    sessionId = sessionId || null;
    
    // Fallback: ถ้ายังไม่ได้ตั้ง API_URL ให้ใช้ google.script.run เดิม
    if (API_URL.indexOf('YOUR_SCRIPT_ID') !== -1 && typeof google !== 'undefined' && google.script && google.script.run) {
        return apiCallLegacy(action, data, sessionId);
    }
    
    // ตรวจสอบ Cache สำหรับ GET requests
    var cacheKey = action + '_' + JSON.stringify(data) + '_' + sessionId;
    if (GET_ACTIONS.indexOf(action) !== -1) {
        var cached = getCached(cacheKey);
        if (cached) return cached;
    }
    
    try {
        var result;
        
        // สร้าง args array เหมือนระบบวัสดุ
        var args = [];
        if (data && Object.keys(data).length > 0) {
            args = [data];
        }
        
        if (GET_ACTIONS.indexOf(action) !== -1) {
            // GET: ข้อมูลทั่วไปผ่าน Query String
            var queryParams = [];
            queryParams.push('fn=' + encodeURIComponent(action));
            if (sessionId) queryParams.push('sessionId=' + encodeURIComponent(sessionId));
            if (args.length > 0) queryParams.push('args=' + encodeURIComponent(JSON.stringify(args)));
            
            var url = API_URL + '?' + queryParams.join('&');
            console.log('[API] GET', url);
            
            var response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' }
            });
            
            console.log('[API] Response status:', response.status, 'content-type:', response.headers.get('content-type'));
            
            if (!response.ok) throw new Error('HTTP ' + response.status);
            
            var contentType = response.headers.get('content-type') || '';
            if (contentType.indexOf('application/json') === -1) {
                var text = await response.text();
                console.error('[API] Expected JSON but got:', contentType, text.substring(0, 200));
                throw new Error('Response is not JSON. Got: ' + contentType);
            }
            
            result = await response.json();
            console.log('[API] JSON result:', result);
            
        } else {
            // POST: ข้อมูลใหญ่ (login, base64 images, processSale, etc.)
            console.log('[API] POST', action);
            var bodyParams = [];
            bodyParams.push('fn=' + encodeURIComponent(action));
            if (sessionId) bodyParams.push('sessionId=' + encodeURIComponent(sessionId));
            if (args.length > 0) bodyParams.push('args=' + encodeURIComponent(JSON.stringify(args)));
            
            var response = await fetch(API_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                body: bodyParams.join('&')
            });
            
            console.log('[API] Response status:', response.status, 'content-type:', response.headers.get('content-type'));
            
            if (!response.ok) throw new Error('HTTP ' + response.status);
            
            var contentType = response.headers.get('content-type') || '';
            if (contentType.indexOf('application/json') === -1) {
                var text = await response.text();
                console.error('[API] Expected JSON but got:', contentType, text.substring(0, 200));
                throw new Error('Response is not JSON. Got: ' + contentType);
            }
            
            result = await response.json();
            console.log('[API] JSON result:', result);
        }
        
        // เก็บ Cache สำหรับ GET requests ที่สำเร็จ
        if (GET_ACTIONS.indexOf(action) !== -1 && result && result.success) {
            setCache(cacheKey, result);
        }
        
        return result;
        
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}

/**
 * Fallback: ใช้ google.script.run เดิม (สำหรับ GAS โดยตรง)
 */
function apiCallLegacy(action, data, sessionId) {
    return new Promise(function(resolve, reject) {
        var timeout = setTimeout(function() {
            reject(new Error('Request timeout (30s)'));
        }, 30000);
        
        google.script.run
            .withSuccessHandler(function(result) {
                clearTimeout(timeout);
                resolve(result);
            })
            .withFailureHandler(function(error) {
                clearTimeout(timeout);
                reject(new Error(error));
            })
            .handleApiRequest({
                action: action,
                data: data,
                sessionId: sessionId
            });
    });
}

/**
 * แสดงข้อความสำเร็จ (Toast) - Fixed: เพิ่มความคมชัด
 */
function showSuccessToast(message) {
    Swal.fire({
        icon: 'success',
        html: `<div style="color: #ffffff !important; font-weight: 700 !important; font-size: 15px !important; text-shadow: 0 2px 4px rgba(0,0,0,0.5) !important; letter-spacing: 0.5px;">${message}</div>`,
        timer: 2500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        iconColor: '#ffffff',
        customClass: {
            popup: 'success-toast-custom',
            icon: 'toast-icon-custom',
            title: 'toast-text-white',
            htmlContainer: 'toast-text-white'
        },
        didOpen: (toast) => {
            toast.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.3)';
            const textElements = toast.querySelectorAll('.swal2-html-container, .swal2-title');
            textElements.forEach(el => {
                el.style.color = '#ffffff !important';
            });
        }
    });
}

/**
 * แสดงข้อความผิดพลาด (Toast) - Fixed: เพิ่มความคมชัด
 */
function showErrorToast(message) {
    Swal.fire({
        icon: 'error',
        html: `<div style="color: #ffffff !important; font-weight: 700 !important; font-size: 15px !important; text-shadow: 0 2px 4px rgba(0,0,0,0.5) !important; letter-spacing: 0.5px;">${message}</div>`,
        timer: 3500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        iconColor: '#ffffff',
        customClass: {
            popup: 'error-toast-custom',
            icon: 'toast-icon-custom',
            title: 'toast-text-white',
            htmlContainer: 'toast-text-white'
        },
        didOpen: (toast) => {
            toast.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.3)';
            const textElements = toast.querySelectorAll('.swal2-html-container, .swal2-title');
            textElements.forEach(el => {
                el.style.color = '#ffffff !important';
            });
        }
    });
}

/**
 * แสดงข้อความเตือน (Toast) - Fixed: เพิ่มความคมชัด
 */
function showWarningToast(message) {
    Swal.fire({
        icon: 'warning',
        html: `<div style="color: #ffffff !important; font-weight: 700 !important; font-size: 15px !important; text-shadow: 0 2px 4px rgba(0,0,0,0.5) !important; letter-spacing: 0.5px;">${message}</div>`,
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        iconColor: '#ffffff',
        customClass: {
            popup: 'warning-toast-custom',
            icon: 'toast-icon-custom',
            title: 'toast-text-white',
            htmlContainer: 'toast-text-white'
        },
        didOpen: (toast) => {
            toast.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.3)';
            const textElements = toast.querySelectorAll('.swal2-html-container, .swal2-title');
            textElements.forEach(el => {
                el.style.color = '#ffffff !important';
            });
        }
    });
}

/**
 * แสดงข้อความสำเร็จ (Modal)
 */
function showSuccess(message) {
    Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: message,
        timer: 2000,
        showConfirmButton: false
    });
}

/**
 * แสดงข้อความข้อผิดพลาด (Modal)
 */
function showError(message) {
    Swal.fire({
        icon: 'error',
        title: 'ข้อผิดพลาด',
        text: message,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#dc2626'
    });
}

/**
 * จัดรูปแบบสกุลเงิน
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * จัดรูปแบบวันที่
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    var date = new Date(dateString);
    return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * ล้างข้อมูลในฟอร์ม
 */
function resetForm(formId) {
    var form = document.getElementById(formId);
    if (form) {
        form.reset();
        
        if (formId === 'addMemberForm') {
            calculateShareAmount();
        } else if (formId === 'addProductForm') {
            var imagePreviewEl = document.getElementById('imagePreview');
            var barcodeDisplayEl = document.getElementById('barcodeDisplay');
            if (imagePreviewEl) imagePreviewEl.classList.add('hidden');
            if (barcodeDisplayEl) barcodeDisplayEl.classList.add('hidden');
        }
    }
}

// ===== SheetJS (XLSX) - Client-side Excel Export =====

function exportProductsToExcel() {
    if (!products || products.length === 0) {
        showError('ไม่มีข้อมูลสินค้า');
        return;
    }
    var data = products.map(function(p) {
        return {
            'บาร์โค้ด': p.barcode,
            'ชื่อสินค้า': p.name,
            'หมวดหมู่': p.category,
            'ราคา': p.price,
            'ต้นทุน': p.cost,
            'สต็อก': p.stock,
            'หน่วย': p.unit,
            'สถานะ': p.active ? 'ใช้งาน' : 'ไม่ใช้งาน'
        };
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'สินค้า');
    XLSX.writeFile(wb, 'รายการสินค้า.xlsx');
}

function exportMembersToExcel() {
    if (!members || members.length === 0) {
        showError('ไม่มีข้อมูลสมาชิก');
        return;
    }
    var data = members.map(function(m) {
        return {
            'รหัสนักเรียน': m.student_id,
            'ชื่อ': m.firstname,
            'นามสกุล': m.lastname,
            'ห้อง': m.classroom,
            'จำนวนหุ้น': m.shares,
            'วันที่สมัคร': formatDate(m.join_date),
            'สถานะ': m.status === 'active' ? 'ใช้งาน' : 'ไม่ใช้งาน'
        };
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'สมาชิก');
    XLSX.writeFile(wb, 'รายการสมาชิก.xlsx');
}

// ===== FileReader + Blob - CSV Import/Export =====

function exportProductsToCSV() {
    if (!products || products.length === 0) {
        showError('ไม่มีข้อมูลสินค้า');
        return;
    }
    var headers = ['barcode', 'name', 'category', 'price', 'cost', 'stock', 'unit'];
    var rows = products.map(function(p) {
        return [p.barcode, p.name, p.category, p.price, p.cost, p.stock, p.unit].join(',');
    });
    var csv = [headers.join(','), rows.join('\n')].join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'products.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importProductsFromCSV(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = e.target.result;
        var lines = text.split('\n');
        var imported = 0;
        for (var i = 1; i < lines.length; i++) {
            var cols = lines[i].split(',');
            if (cols.length >= 7 && cols[1].trim()) {
                imported++;
            }
        }
        showSuccess('อ่านไฟล์ CSV สำเร็จ (' + imported + ' รายการ)');
    };
    reader.readAsText(file);
}

// ===== QR Code + window.print() - Print Sticker Labels =====

function printProductSticker(productId) {
    var product = products.find(function(p) { return p.id === productId; });
    if (!product) return;
    var barcodeUrl = product.barcode_image_url || ('https://barcode.tec-it.com/barcode.ashx?data=' + product.barcode + '&code=Code128&dpi=96&imagetype=Gif');
    var printHtml = '<div style="width: 50mm; height: 30mm; padding: 2mm; text-align: center; font-family: sans-serif; border: 1px dashed #ccc;">' +
        '<div style="font-size: 10px; font-weight: bold; margin-bottom: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">' + product.name + '</div>' +
        '<img src="' + barcodeUrl + '" style="height: 16mm;" alt="barcode">' +
        '<div style="font-size: 8px; color: #666;">' + product.barcode + '</div>' +
        '<div style="font-size: 11px; font-weight: bold; color: #059669;">' + formatCurrency(product.price) + '</div>' +
    '</div>';
    var w = window.open('', '_blank');
    w.document.write('<html><head><style>@media print { @page { size: 50mm 30mm; margin: 0; } body { margin: 0; padding: 0; } }</style></head><body>' + printHtml + '</body></html>');
    w.document.close();
    setTimeout(function() { w.print(); w.close(); }, 300);
}

function printAllStickers() {
    var html = '';
    products.forEach(function(product) {
        var barcodeUrl = product.barcode_image_url || ('https://barcode.tec-it.com/barcode.ashx?data=' + product.barcode + '&code=Code128&dpi=96&imagetype=Gif');
        html += '<div style="display: inline-block; width: 50mm; height: 30mm; padding: 2mm; text-align: center; font-family: sans-serif; border: 1px dashed #ccc; page-break-inside: avoid; margin: 1mm;">' +
            '<div style="font-size: 10px; font-weight: bold; margin-bottom: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">' + product.name + '</div>' +
            '<img src="' + barcodeUrl + '" style="height: 16mm;" alt="barcode">' +
            '<div style="font-size: 8px; color: #666;">' + product.barcode + '</div>' +
            '<div style="font-size: 11px; font-weight: bold; color: #059669;">' + formatCurrency(product.price) + '</div>' +
        '</div>';
    });
    var w = window.open('', '_blank');
    w.document.write('<html><head><style>@media print { @page { size: A4; margin: 5mm; } body { margin: 0; padding: 0; } }</style></head><body>' + html + '</body></html>');
    w.document.close();
    setTimeout(function() { w.print(); w.close(); }, 500);
}
</script>