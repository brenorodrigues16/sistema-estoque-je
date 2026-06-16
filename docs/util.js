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