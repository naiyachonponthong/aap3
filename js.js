<script>
/**
 * js.js - ระบบจัดการ UI, Sidebar, และ Page Navigation v2.3
 *
 * - อัปเดต: เพิ่มสถานะ Collapsed (ย่อ) สำหรับ Desktop
 * - เปลี่ยนจากการใช้ Modal สำหรับหน้าหลัก เป็นการสลับหน้า (showPage)
 * - เก็บ showModal/hideModal ไว้สำหรับ pop-up ย่อย (เช่น เพิ่ม/แก้ไข)
 * - เพิ่มการตรวจสอบสิทธิ์สำหรับเมนู (Admin)
 * - อัปเดต: ใช้ loadDashboardRefresh จาก script.js เพื่อดึงข้อมูลจริง
 */

// ===== Global Variables for UI =====
var sidebarState = {
    isOpen: false,
    isMobile: false,
    isCollapsed: false // *** NEW: สถานะย่อเมนู ***
};
var salesChartInstance = null;
var quickChartInstance = null;
var currentPageId = 'dashboardContent'; // ✅ เก็บหน้าปัจจุบัน

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', function() {
    // `initializeApp` (ใน script.js) จะถูกเรียกก่อน
    // และ `initializeApp` จะเรียก `showMainApp`
    // `showMainApp` (ใน script.js) จะเรียก `initializeSidebar()` ที่อยู่ในไฟล์นี้
});


// ===== Core Navigation =====

/**
 * ฟังก์ชันหลักในการสลับหน้า (แทนที่ showModal เดิม)
 * @param {string} pageId - ID ของ <div> ที่เป็นหน้า (เช่น 'dashboardContent', 'paymentPage')
 */
function showPage(pageId) {
    // ✅ เก็บ pageId ปัจจุบัน
    currentPageId = pageId;
    
    // ❌ Clear loading ที่เก่า
    if (typeof hideAllLoading === 'function') {
        hideAllLoading();
    }
    
    // 1. ซ่อนทุกหน้า (div.page-content)
    var pages = document.querySelectorAll('.page-content');
    pages.forEach(function(page) {
        if (page) page.classList.add('hidden');
    });

    // 2. แสดงหน้า S(ที่เลือก
    var pageToShow = document.getElementById(pageId);
    if (pageToShow) {
        pageToShow.classList.remove('hidden');
    } else {
        // ถ้าไม่เจอ ให้กลับไปหน้า Dashboard
        var dashboard = document.getElementById('dashboardContent');
        if (dashboard) dashboard.classList.remove('hidden');
        pageId = 'dashboardContent';
        currentPageId = pageId;
    }

    // 3. อัปเดต Breadcrumb และ Active Menu
    var breadcrumbText = 'ภาพรวมร้านค้า';
    var functionCall = "showPage('" + pageId + "')";

    switch (pageId) {
        case 'dashboardContent':
            breadcrumbText = 'ภาพรวมร้านค้า';
            functionCall = "showDashboard()"; // ใช้ showDashboard() เพื่อโหลดข้อมูล
            break;
        case 'paymentPage':
            breadcrumbText = 'ขายสินค้า';
            // รีเซ็ตการค้นหาสินค้าเมื่อเปิดหน้าขาย
            var searchInput = document.getElementById('productSearchInput');
            var categoryFilter = document.getElementById('categoryFilter');
            if (searchInput) searchInput.value = '';
            if (categoryFilter) categoryFilter.value = '';
            if (typeof filterProductGrid === 'function') filterProductGrid();
            break;
        case 'manageProductsPage':
            breadcrumbText = 'จัดการสินค้า';
            if (typeof loadProductManagement === 'function') loadProductManagement(); // โหลดข้อมูลเมื่อเปิดหน้า
            break;
        case 'manageMembersPage':
    breadcrumbText = 'จัดการสมาชิก';
    if (typeof loadMembers === 'function' && typeof loadMemberManagement === 'function') {
        loadMembers().then(() => {
            // ตรวจสอบว่ายังอยู่หน้าเดิมก่อนโหลด
            if (currentPageId === 'manageMembersPage') {
                loadMemberManagement();
            }
        }).catch(err => console.error('Error loading members:', err));
    }
    break;
        case 'manageUsersPage':
            breadcrumbText = 'จัดการผู้ใช้งาน';
            if (typeof loadUsers === 'function' && typeof loadUsersManagement === 'function') {
                // ⚡ เรียก async loadUsers แบบ background (ไม่ block showPage)
                loadUsers().then(() => {
                    loadUsersManagement();
                }).catch(err => {
                    console.error('Error loading users:', err);
                    showError('เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้งาน');
                    loadUsersManagement(); // แสดงข้อมูลเก่า
                });
            }
            break;
        case 'reportsPage':
            breadcrumbText = 'รายงานยอดขาย';
            break;
        case 'settingsPage':
            breadcrumbText = 'ตั้งค่าระบบ';
            if (typeof loadSettings === 'function') loadSettings(); // โหลดข้อมูลเมื่อเปิดหน้า
            break;
    }

    updateBreadcrumb(breadcrumbText);
    setActiveMenuItem(functionCall);

    // 4. ซ่อน Sidebar (สำหรับมือถือ)
    if (sidebarState.isMobile) {
        hideSidebar();
    }
    
    // 5. หยุดการสแกน ถ้าออกจากหน้าขาย
    if (pageId !== 'paymentPage' && typeof isScanning !== 'undefined' && isScanning) {
        if (typeof stopScanning === 'function') stopScanning();
    }
    
    // 6. Announce page change
    announceToScreenReader('เปลี่ยนไปหน้า ' + breadcrumbText);
}

/**
 * ทางลัดสำหรับไปหน้า Dashboard และโหลดข้อมูล
 */
function showDashboard() {
    showPage('dashboardContent');
    // โหลดข้อมูล dashboard
    if (typeof loadDashboardData === 'function') {
        loadDashboardData();
    }
}

/**
 * อัพเดท Breadcrumb
 * @param {string} currentPage - ชื่อหน้าปัจจุบัน (ภาษาไทย)
 */
function updateBreadcrumb(currentPage) {
    var breadcrumbCurrent = document.getElementById('breadcrumbCurrent');
    if (breadcrumbCurrent) {
        breadcrumbCurrent.textContent = currentPage;
    }
}

/**
 * ตั้งค่า Active Menu Item ใน Sidebar
 * @param {string} functionName - ชื่อฟังก์ชัน onclick (เช่น "showPage('paymentPage')")
 */
function setActiveMenuItem(functionName) {
    var menuItems = document.querySelectorAll('.sidebar-menu-item');
    
    menuItems.forEach(function(item) {
        item.classList.remove('active');
        var onclick = item.getAttribute('onclick');
        
        // เปรียบเทียบโดยตัดช่องว่างและเครื่องหมาย '
        if (onclick && onclick.replace(/['"\s]/g, '') === functionName.replace(/['"\s]/g, '')) {
            item.classList.add('active');
        }
    });
}


// ===== Modal Management (สำหรับ Pop-up ย่อย) =====

/**
 * แสดง Modal (สำหรับ pop-up ย่อย เช่น เพิ่ม/แก้ไข)
 * @param {string} modalId - ID ของ Modal ที่จะแสดง
 */
function showModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    
    // Focus on first input
    var firstInput = document.querySelector('#' + modalId + ' input, #' + modalId + ' select');
    if (firstInput) {
        setTimeout(function() { firstInput.focus(); }, 100);
    }
}

/**
 * ซ่อน Modal
 * @param {string} modalId - ID ของ Modal ที่จะซ่อน
 */
function hideModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // คืนค่า scrollbar (ถ้าไม่มี modal อื่นเปิดอยู่)
    // ตรวจสอบ modal อื่นๆ ที่ยังเปิดอยู่ (ยกเว้น imagePopupModal ที่จัดการแยก)
    var otherModalsOpen = document.querySelectorAll('.fixed.inset-0.z-50:not(.hidden):not(#imagePopupModal)').length > 0;
    
    // ตรวจสอบว่า image popup เปิดอยู่หรือไม่
    var imagePopupOpen = !document.getElementById('imagePopupModal').classList.contains('hidden');

    if (!otherModalsOpen && !imagePopupOpen) {
        document.body.style.overflow = 'auto';
    }
}


// ===== Sidebar Management =====

/**
 * เริ่มต้น Sidebar และ Event Listeners
 */
function initializeSidebar() {
    checkMobileView();
    loadSidebarState();
    setupSidebarEventListeners();
    updateSidebarDisplay();
    checkPermissions(); // ตรวจสอบสิทธิ์หลัง
}

/**
 * ตั้งค่า Event Listeners สำหรับ Sidebar
 */
function setupSidebarEventListeners() {
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click', hideSidebar);
    
    window.addEventListener('resize', debounce(function() {
        var wasMobile = sidebarState.isMobile;
        checkMobileView();
        
        // ถ้าเปลี่ยนจาก Mobile เป็น Desktop หรือกลับกัน ให้รีเซ็ตสถานะ
        if (wasMobile !== sidebarState.isMobile) {
            loadSidebarState(); // โหลดสถานะเริ่มต้นใหม่ตามขนาดจอ
        }
        updateSidebarDisplay();
    }, 200));
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sidebarState.isMobile && sidebarState.isOpen) {
            hideSidebar();
        }
    });
}

/**
 * ตรวจสอบสิทธิ์ผู้ใช้เพื่อแสดง/ซ่อนเมนู (Role-based UI ฝั่ง Frontend)
 * รองรับทั้ง data-permission และ data-role
 */
function checkPermissions() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    
    var allMenuItems = document.querySelectorAll('.sidebar-menu-item[data-permission], .sidebar-menu-item[data-role]');
    
    allMenuItems.forEach(function(item) {
        var requiredPermission = item.getAttribute('data-permission');
        var requiredRole = item.getAttribute('data-role');
        
        var hasPermission = true;
        if (requiredPermission === 'admin' && currentUser.role !== 'admin') {
            hasPermission = false;
        }
        if (requiredRole === 'admin' && currentUser.role !== 'admin') {
            hasPermission = false;
        }
        
        if (hasPermission) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

function checkMobileView() {
    sidebarState.isMobile = window.innerWidth < 1024;
}

function loadSidebarState() {
    try {
        var savedState = localStorage.getItem('schoolCoop_sidebarState_v2'); 
        if (savedState) {
            var state = JSON.parse(savedState);
            // ถ้าเป็น Mobile, isOpen ต้องเป็น false เสมอเมื่อโหลด
            sidebarState.isOpen = sidebarState.isMobile ? false : state.isOpen;
            sidebarState.isCollapsed = state.isCollapsed || false;
        } else {
            // Default state
            sidebarState.isOpen = !sidebarState.isMobile; // Desktop เปิด, Mobile ปิด
            sidebarState.isCollapsed = false;
        }
    } catch (e) {
        sidebarState.isOpen = !sidebarState.isMobile;
        sidebarState.isCollapsed = false;
    }
}

/**
 * *** UPDATED: บันทึกสถานะ Sidebar (รวมสถานะย่อ) ***
 */
function saveSidebarState() {
    try {
        localStorage.setItem('schoolCoop_sidebarState_v2', JSON.stringify(sidebarState)); // v2
    } catch (e) {
        console.warn("Could not save sidebar state.");
    }
}

/**
 * *** UPDATED: Toggle Sidebar (จัดการย่อ/ขยาย) ***
 */
function toggleSidebar() {
    if (sidebarState.isMobile) {
        // Mobile: สลับการ เปิด/ปิด (ทับจอ)
        sidebarState.isOpen = !sidebarState.isOpen;
    } else {
        // Desktop: สลับการ ย่อ/ขยาย
        sidebarState.isCollapsed = !sidebarState.isCollapsed;
        sidebarState.isOpen = true; // Desktop เปิดเสมอ
    }
    
    updateSidebarDisplay();
    saveSidebarState();
}

/**
 * แสดง Sidebar (สำหรับ Mobile)
 */
function showSidebar() {
    if (!sidebarState.isMobile) return; // ใช้ toggleSidebar() สำหรับ Desktop
    sidebarState.isOpen = true;
    updateSidebarDisplay();
    saveSidebarState();
    announceToScreenReader('เปิดเมนูการนำทาง');
}

/**
 * ซ่อน Sidebar (สำหรับ Mobile)
 */
function hideSidebar() {
    if (!sidebarState.isMobile) return; // ใช้ toggleSidebar() สำหรับ Desktop
    sidebarState.isOpen = false;
    updateSidebarDisplay();
    saveSidebarState();
    announceToScreenReader('ปิดเมนูการนำทาง');
}

/**
 * *** UPDATED: อัพเดทการแสดงผล Sidebar (จัดการย่อ/ขยาย) ***
 */
function updateSidebarDisplay() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var mainContent = document.getElementById('mainContent');
    var toggleIcon = document.querySelector('#sidebarToggle i');

    if (!sidebar || !overlay || !mainContent || !toggleIcon) return;

    if (sidebarState.isMobile) {
        // --- Mobile Behavior ---
        // ล้างสถานะย่อ/ขยายของ Desktop
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('collapsed');
        
        if (sidebarState.isOpen) {
            sidebar.classList.add('show');
            overlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            toggleIcon.className = 'fas fa-times text-xl';
        } else {
            sidebar.classList.remove('show');
            overlay.classList.add('hidden');
            document.body.style.overflow = 'auto';
            toggleIcon.className = 'fas fa-bars text-xl';
        }
        mainContent.classList.add('with-sidebar'); // Mobile margin-left ถูกควบคุมโดย CSS @media

    } else {
        // --- Desktop Behavior ---
        // ซ่อน overlay และคืนค่า body scroll
        overlay.classList.add('hidden');
        document.body.style.overflow = 'auto';
        
        // Desktop เปิดตลอด
        sidebar.classList.add('show');
        mainContent.classList.add('with-sidebar');

        // สลับสถานะ ย่อ/ขยาย
        if (sidebarState.isCollapsed) {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('collapsed');
            toggleIcon.className = 'fas fa-bars text-xl'; // ปุ่ม 3 ขีด (แสดงว่าย่ออยู่)
        } else {
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('collapsed');
            toggleIcon.className = 'fas fa-times text-xl'; // ปุ่มกากบาท (แสดงว่าขยายอยู่)
        }
    }
}


// ===== Dashboard Data Functions (UPDATED) =====

/**
 * โหลดข้อมูล Dashboard (เรียกใช้ loadDashboardRefresh จาก script.js)
 */
async function loadDashboardData() {
    if (typeof loadDashboardRefresh === 'function') {
        await loadDashboardRefresh();
    } else {
        console.error('loadDashboardRefresh function not found in script.js');
        // Fallback: load chart with mock data if core logic is missing
        loadQuickChart();
    }
}

/**
 * โหลด Quick Chart (จำลอง)
 */
function loadQuickChart(salesData, labels) {
    var canvas = document.getElementById('quickChart');
    if (!canvas) return;
    
    var ctx = canvas.getContext('2d');
    
    if (quickChartInstance) {
        quickChartInstance.destroy();
    }
    
    // ใช้ข้อมูลจริงถ้าถูกส่งมา, มิฉะนั้นใช้ mock data
    if (!labels || labels.length === 0) {
        labels = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(function(day, i) {
            var d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        });
        salesData = [1200, 1900, 1500, 2100, 1800, 2500, 2300]; // ข้อมูลจำลอง
    }

    
    quickChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'ยอดขาย (บาท)',
                data: salesData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            var val = context.parsed.y;
                            return 'ยอดขาย: ' + (typeof formatCurrency === 'function' ? formatCurrency(val) : val);
                        }
                    }
                }
            }
        }
    });
}


// ===== Utility Functions =====

/**
 * ประกาศข้อความสำหรับ Screen Reader
 * @param {string} message - ข้อความ
 */
function announceToScreenReader(message) {
    var announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only'; // Tailwind class for screen-reader only
    announcement.style.position = 'absolute';
    announcement.style.left = '-9999px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(function() {
        if (document.body.contains(announcement)) {
            document.body.removeChild(announcement);
        }
    }, 1000);
}

/**
 * Debounce function
 * @param {Function} func - ฟังก์ชันที่ต้องการ debounce
 * @param {number} wait - เวลา (ms)
 */
function debounce(func, wait) {
    var timeout;
    return function executedFunction() {
        var context = this;
        var args = arguments;
        var later = function() {
            timeout = null;
            func.apply(context, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== Keyboard Shortcuts (ปรับปรุง) =====
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + shortcuts
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case '1': // Ctrl+1 - เปิดหน้าขาย
                e.preventDefault();
                showPage('paymentPage');
                break;
            case '2': // Ctrl+2 - จัดการสินค้า
                e.preventDefault();
                showPage('manageProductsPage');
                break;
            case '3': // Ctrl+3 - จัดการสมาชิก
                e.preventDefault();
                showPage('manageMembersPage');
                break;
            case '4': // Ctrl+4 - รายงาน
                e.preventDefault();
                showPage('reportsPage');
                break;
            case 'h': // Ctrl+H - กลับหน้าหลัก
                e.preventDefault();
                showDashboard();
                break;
            case 'b': // Ctrl+B - สลับ Sidebar
                e.preventDefault();
                toggleSidebar();
                break;
        }
    }
});

console.log('UI Navigation System (js.js) v2.3 (Collapsible) Loaded.');
</script>