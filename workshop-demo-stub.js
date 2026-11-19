/* Isolated workshop adapter: NO LIVE authentication, student data or Hub writes. */
(() => {
  'use strict';
  const unsupported = () => Promise.reject(new Error('Student database is unavailable in this workshop demo.'));
  window.BUICWorkspaceAuth = Object.freeze({
    login: unsupported,
    logout: () => {},
    isAuthenticated: () => true,
    getIdentity: () => ({id:'workshop-demo-officer', name:'Workshop Demo'}),
    retryConnection: unsupported
  });
  window.BUICStudentMemory = Object.freeze({
    baseUrl: '',
    open: () => window.alert('Student Database is disabled in the workshop demo. Use fictional student details.'),
    isAuthenticated: () => false,
    getStudent: unsupported,
    remember: unsupported,
    rememberMany: unsupported,
    checkDocument: async () => ({ok:true,demo:true,notice:'Server checks are disabled in this workshop demo.'}),
    proposeRevision: unsupported,
    requireAuth: unsupported,
    validateSession: async () => false,
    logout: () => {}
  });
})();
