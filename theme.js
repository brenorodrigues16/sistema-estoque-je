// theme.js
const temaSalvo = localStorage.getItem('tema') || 'claro';
if (temaSalvo === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
} else {
    document.documentElement.setAttribute('data-theme', 'claro');
}