/**
 * @typedef {Object} StateChangeEvent
 * @property {string} key - The state key that changed
 * @property {any} value - The new value
 * @property {any} oldValue - The previous value
 */

/**
 * @callback StateChangeCallback
 * @param {StateChangeEvent} event
 */

/**
 * @typedef {Object} TabOptions
 * @property {string} stateKey - Key to use for state persistence
 * @property {string} defaultTab - Default tab to show if none active
 * @property {boolean} [persist=true] - Whether to persist tab state
 */

/**
 * Core state and event manager
 * @class
 */
class StateManager {
    constructor() {
        /** @type {Object.<string, any>} */
        this.state = {};
        
        /** @type {Object.<string, StateChangeCallback[]>} */
        this.listeners = {};
        
        /** @type {Object.<string, any>} */
        this.persistentKeys = new Set();
        
        this.init();
    }

    /**
     * Initialize state from localStorage
     * @private
     */
    init() {
        // Restore any persisted state
        try {
            const saved = localStorage.getItem('appState');
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(key => {
                    this.state[key] = parsed[key];
                    this.persistentKeys.add(key);
                });
            }
        } catch (e) {
            console.error('Failed to restore state:', e);
        }
    }

    /**
     * Get a state value
     * @param {string} key - State key
     * @param {any} [defaultValue] - Default value if key doesn't exist
     * @returns {any}
     */
    get(key, defaultValue = null) {
        return this.state[key] ?? defaultValue;
    }

    /**
     * Set a state value
     * @param {string} key - State key
     * @param {any} value - New value
     * @param {boolean} [persist=false] - Whether to persist to localStorage
     */
    set(key, value, persist = false) {
        const oldValue = this.state[key];
        this.state[key] = value;

        if (persist) {
            this.persistentKeys.add(key);
            this.saveToStorage();
        }

        this.notify(key, value, oldValue);
    }

    /**
     * Subscribe to state changes
     * @param {string} key - State key to watch
     * @param {StateChangeCallback} callback - Callback function
     */
    subscribe(key, callback) {
        if (!this.listeners[key]) {
            this.listeners[key] = [];
        }
        this.listeners[key].push(callback);
    }

    /**
     * Unsubscribe from state changes
     * @param {string} key - State key
     * @param {StateChangeCallback} callback - Callback function
     */
    unsubscribe(key, callback) {
        if (this.listeners[key]) {
            this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
        }
    }

    /**
     * Notify listeners of state change
     * @private
     * @param {string} key - Changed state key
     * @param {any} value - New value
     * @param {any} oldValue - Previous value
     */
    notify(key, value, oldValue) {
        if (this.listeners[key]) {
            const event = { key, value, oldValue };
            this.listeners[key].forEach(callback => callback(event));
        }
    }

    /**
     * Save persistent state to localStorage
     * @private
     */
    saveToStorage() {
        const persistentState = {};
        this.persistentKeys.forEach(key => {
            persistentState[key] = this.state[key];
        });
        localStorage.setItem('appState', JSON.stringify(persistentState));
    }

    /**
     * Clear all state and storage
     */
    clear() {
        this.state = {};
        this.persistentKeys.clear();
        localStorage.removeItem('appState');
    }
}

/**
 * @typedef {Object} DialogOptions
 * @property {string} id - Unique dialog identifier
 * @property {string} stateKey - State key for persistence (defaults to `dialog_${id}`)
 * @property {boolean} [persist=true] - Whether to persist dialog state
 * @property {boolean} [closeOnEscape=true] - Close dialog on escape key
 * @property {boolean} [closeOnOutsideClick=true] - Close dialog when clicking outside
 * @property {function} [onOpen] - Callback when dialog opens
 * @property {function} [onClose] - Callback when dialog closes
 * @property {boolean} [restoreOnLoad=true] - Restore open state on page load
 */

/**
 * Dialog system manager
 * @class
 */
class DialogManager {
    /**
     * Create a dialog manager
     */
    constructor() {
        /** @type {Object.<string, HTMLElement>} */
        this.dialogs = {};
        
        /** @type {Object.<string, DialogOptions>} */
        this.options = {};
        
        /** @type {Object.<string, function>} */
        this.escapeHandlers = {};
        
        /** @type {Object.<string, function>} */
        this.outsideClickHandlers = {};
        
        /** @type {Set<string>} */
        this.activeDialogs = new Set();
        
        /** @type {string} */
        this.STATE_KEY_PREFIX = 'dialog_';
        
        // Bind event handlers
        this._handleKeyDown = this._handleKeyDown.bind(this);
        this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
        
        // Add global event listeners
        document.addEventListener('keydown', this._handleKeyDown);
        window.addEventListener('beforeunload', this._handleBeforeUnload);
        
        // Restore dialogs on page load
        document.addEventListener('DOMContentLoaded', () => {
            this._restoreDialogs();
        });
    }
    
    /**
     * Register a dialog with the manager
     * @param {string} selector - CSS selector for the dialog element
     * @param {DialogOptions} options - Dialog options
     * @returns {boolean} - Whether registration was successful
     */
    register(selector, options) {
        const element = document.querySelector(selector);
        if (!element) {
            console.error(`Dialog element not found: ${selector}`);
            return false;
        }
        
        const id = options.id || element.id || `dialog-${Object.keys(this.dialogs).length}`;
        const stateKey = options.stateKey || `${this.STATE_KEY_PREFIX}${id}`;
        
        // Default options
        const dialogOptions = {
            id,
            stateKey,
            persist: options.persist !== false,
            closeOnEscape: options.closeOnEscape !== false,
            closeOnOutsideClick: options.closeOnOutsideClick !== false,
            onOpen: options.onOpen || null,
            onClose: options.onClose || null,
            restoreOnLoad: options.restoreOnLoad !== false
        };
        
        // Store dialog and options
        this.dialogs[id] = element;
        this.options[id] = dialogOptions;
        
        // Set up outside click handler if enabled
        if (dialogOptions.closeOnOutsideClick) {
            this.outsideClickHandlers[id] = (event) => {
                if (event.target === element) {
                    this.close(id);
                }
            };
            element.addEventListener('click', this.outsideClickHandlers[id]);
        }
        
        // Subscribe to state changes for this dialog
        window.state.subscribe(stateKey, (event) => {
            if (event.value && !this.isOpen(id)) {
                this._openDialog(id, false);
            } else if (!event.value && this.isOpen(id)) {
                this._closeDialog(id, false);
            }
        });
        
        return true;
    }
    
    /**
     * Open a registered dialog
     * @param {string} id - Dialog ID
     */
    open(id) {
        if (!this.dialogs[id]) {
            console.error(`Dialog not registered: ${id}`);
            return;
        }
        
        this._openDialog(id, true);
    }
    
    /**
     * Close a registered dialog
     * @param {string} id - Dialog ID
     */
    close(id) {
        if (!this.dialogs[id]) {
            console.error(`Dialog not registered: ${id}`);
            return;
        }
        
        this._closeDialog(id, true);
    }
    
    /**
     * Check if a dialog is currently open
     * @param {string} id - Dialog ID
     * @returns {boolean}
     */
    isOpen(id) {
        if (!this.dialogs[id]) {
            return false;
        }
        
        return this.activeDialogs.has(id) || 
            this.dialogs[id].getAttribute('data-active') === 'true';
    }
    
    /**
     * Toggle a dialog's open state
     * @param {string} id - Dialog ID
     */
    toggle(id) {
        if (this.isOpen(id)) {
            this.close(id);
        } else {
            this.open(id);
        }
    }
    
    /**
     * Internal method to open a dialog
     * @private
     * @param {string} id - Dialog ID
     * @param {boolean} updateState - Whether to update state
     */
    _openDialog(id, updateState = true) {
        const dialog = this.dialogs[id];
        const options = this.options[id];
        
        // Mark as active
        dialog.setAttribute('data-active', 'true');
        this.activeDialogs.add(id);
        
        // Add no-scroll to body
        document.body.classList.add('no-scroll');
        
        // Update state if requested
        if (updateState && options.persist) {
            window.state.set(options.stateKey, true, true);
        }
        
        // Call onOpen callback if provided
        if (typeof options.onOpen === 'function') {
            options.onOpen(dialog);
        }
    }
    
    /**
     * Internal method to close a dialog
     * @private
     * @param {string} id - Dialog ID
     * @param {boolean} updateState - Whether to update state
     */
    _closeDialog(id, updateState = true) {
        const dialog = this.dialogs[id];
        const options = this.options[id];
        
        // Mark as inactive
        dialog.setAttribute('data-active', 'false');
        this.activeDialogs.delete(id);
        
        // Remove no-scroll from body if no other dialogs are open
        if (this.activeDialogs.size === 0) {
            document.body.classList.remove('no-scroll');
        }
        
        // Update state if requested
        if (updateState && options.persist) {
            window.state.set(options.stateKey, false, true);
        }
        
        // Call onClose callback if provided
        if (typeof options.onClose === 'function') {
            options.onClose(dialog);
        }
    }
    
    /**
     * Handle keydown events for escape key
     * @private
     * @param {KeyboardEvent} event
     */
    _handleKeyDown(event) {
        if (event.key === 'Escape') {
            // Close dialogs in reverse order of activation (LIFO)
            const activeDialogIds = Array.from(this.activeDialogs);
            for (let i = activeDialogIds.length - 1; i >= 0; i--) {
                const id = activeDialogIds[i];
                if (this.options[id].closeOnEscape) {
                    this.close(id);
                    break; // Only close the topmost dialog
                }
            }
        }
    }
    
    /**
     * Save dialog states before page unloads
     * @private
     */
    _handleBeforeUnload() {
        // Save all active dialog states
        this.activeDialogs.forEach(id => {
            const options = this.options[id];
            if (options.persist) {
                window.state.set(options.stateKey, true, true);
            }
        });
    }
    
    /**
     * Restore dialog states on page load
     * @private
     */
    _restoreDialogs() {
        // Restore dialogs that were open
        Object.keys(this.options).forEach(id => {
            const options = this.options[id];
            if (options.persist && options.restoreOnLoad) {
                const isOpen = window.state.get(options.stateKey, false);
                if (isOpen) {
                    // Use setTimeout to ensure DOM is fully loaded
                    setTimeout(() => this.open(id), 0);
                }
            }
        });
    }
    
    /**
     * Clean up event listeners
     * @public
     */
    destroy() {
        // Remove global event listeners
        document.removeEventListener('keydown', this._handleKeyDown);
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        
        // Remove dialog-specific event listeners
        Object.keys(this.outsideClickHandlers).forEach(id => {
            const dialog = this.dialogs[id];
            const handler = this.outsideClickHandlers[id];
            if (dialog && handler) {
                dialog.removeEventListener('click', handler);
            }
        });
        
        // Clear dialog tracking
        this.dialogs = {};
        this.options = {};
        this.escapeHandlers = {};
        this.outsideClickHandlers = {};
        this.activeDialogs.clear();
    }
}

/**
 * Tab system manager
 * @class
 */
class TabManager {
    /**
     * @param {string} containerSelector - Selector for tab container
     * @param {TabOptions} options - Tab configuration options
     */
    constructor(containerSelector, options) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) return;

        this.options = {
            persist: true,
            ...options
        };

        this.buttons = this.container.querySelectorAll('[data-tab-button]');
        this.contents = this.container.querySelectorAll('[data-tab-content]');
        
        this.init();
    }

    /**
     * Initialize tab system
     * @private
     */
    init() {
        // First deactivate all tabs
        this.deactivateAllTabs();

        // Try to restore state or use default
        const activeTab = this.options.persist ? 
            window.state.get(this.options.stateKey, this.options.defaultTab) : 
            this.options.defaultTab;

        // Activate initial tab
        if (activeTab) {
            this.activateTab(activeTab);
        } else if (this.buttons.length > 0) {
            // Fallback to first tab if no active tab
            const firstTab = this.buttons[0].getAttribute('data-tab-button');
            this.activateTab(firstTab);
        }

        // Setup click handlers
        this.buttons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab-button');
                this.activateTab(tabId);
            });
        });
    }

    /**
     * Deactivate all tabs
     * @private
     */
    deactivateAllTabs() {
        this.buttons.forEach(btn => btn.setAttribute('data-active', 'false'));
        this.contents.forEach(content => content.setAttribute('data-active', 'false'));
    }

    /**
     * Activate a specific tab
     * @param {string} tabId - ID of tab to activate
     * @public
     */
    activateTab(tabId) {
        this.deactivateAllTabs();

        const button = Array.from(this.buttons)
            .find(btn => btn.getAttribute('data-tab-button') === tabId);
        const content = Array.from(this.contents)
            .find(content => content.getAttribute('data-tab-content') === tabId);

        if (button && content) {
            button.setAttribute('data-active', 'true');
            content.setAttribute('data-active', 'true');

            if (this.options.persist) {
                window.state.set(this.options.stateKey, tabId, true);
            }
        }
    }
}

// Create global state manager instance
window.state = new StateManager();

// Export managers for global use
window.TabManager = TabManager;
window.DialogManager = DialogManager;

// Create global dialog manager
window.dialogs = new DialogManager();

// Theme toggle functionality
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.querySelector('[data-theme-toggle]');
    const root = document.documentElement;
    
    // Check for saved theme preference or use system preference
    const savedTheme = localStorage.getItem('theme') || 
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    
    // Set initial theme
    root.setAttribute('data-theme', savedTheme);
    
    themeToggle?.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        root.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}); 