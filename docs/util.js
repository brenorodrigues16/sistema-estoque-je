function tratarErro(titulo, texto, icone = 'error', erroOriginal = null) {
    if (icone instanceof Error || icone instanceof TypeError) {
        erroOriginal = icone;
        icone = 'error';
    }
    
    if (erroOriginal) console.error("Detalhe técnico:", erroOriginal);
    
    return Swal.fire({
        icon: icone,
        title: titulo,
        text: texto,
        confirmButtonColor: '#3085d6'
    });
}


// --- SISTEMA DE CONTROLE DE ACESSO POR CARGO ---

const CARGOS = {
    ADM: ['ADM'],
    GERENTE: ['ADM', 'GERENTE'],
    OPERADOR: ['ADM', 'GERENTE', 'OPERADOR'],
    EXPEDICAO: ['ADM', 'GERENTE', 'EXPEDICAO'],
    TODOS: ['ADM', 'GERENTE', 'OPERADOR', 'EXPEDICAO']
};

function verificarAcesso(cargosPermitidos) {
    const cargo = (localStorage.getItem('cargo') || '').toUpperCase().trim();
    const logado = localStorage.getItem('logado');

    if (logado !== 'true') {
        window.location.href = 'login.html';
        return false;
    }

    if (!cargosPermitidos.includes(cargo)) {
        Swal.fire({
            icon: 'error',
            title: 'Acesso negado',
            text: 'Você não tem permissão para acessar esta página.',
            confirmButtonColor: '#e74c3c'
        }).then(() => {
            window.location.href = 'index.html';
        });
        return false;
    }

    return true;
}

function isAdmin() {
    return (localStorage.getItem('cargo') || '').toUpperCase().trim() === 'ADM';
}

function getCargoAtual() {
    return (localStorage.getItem('cargo') || '').toUpperCase().trim();
}

function mostrarSeAdmin(seletor) {
    if (isAdmin()) {
        const el = document.querySelector(seletor);
        if (el) el.style.display = '';
    }
}