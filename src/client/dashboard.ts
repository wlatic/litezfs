// Dashboard client-side enhancements
// Mostly htmx handles updates, this adds terminal drawer toggle

document.addEventListener('DOMContentLoaded', () => {
  const drawerToggle = document.getElementById('terminal-drawer-toggle');
  const drawer = document.getElementById('terminal-drawer');
  const drawerContent = document.getElementById('terminal-drawer-content');
  let drawerTerminal: { term: { focus: () => void }; fitAddon: { fit: () => void } } | null = null;

  if (drawerToggle && drawer) {
    drawerToggle.addEventListener('click', () => {
      const isOpen = drawer.classList.contains('translate-y-0');

      if (isOpen) {
        // Close drawer
        drawer.classList.remove('translate-y-0');
        drawer.classList.add('translate-y-full');
      } else {
        // Open drawer
        drawer.classList.remove('translate-y-full');
        drawer.classList.add('translate-y-0');

        // Initialize terminal on first open
        if (!drawerTerminal && drawerContent) {
          const createTerminal = (window as any).createTerminal;
          if (createTerminal) {
            drawerTerminal = createTerminal('terminal-drawer-content');
          }
        }

        // Focus and fit terminal
        if (drawerTerminal?.term) {
          drawerTerminal.fitAddon.fit();
          drawerTerminal.term.focus();
        }
      }
    });
  }

  // Sidebar active state
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('[data-nav-link]');
  for (const link of navLinks) {
    const href = link.getAttribute('href');
    if (href === currentPath || (href === '/' && currentPath === '/')) {
      link.classList.add('bg-surface-600', 'text-white');
      link.classList.remove('text-gray-400', 'hover:bg-surface-700');
    }
  }
});
