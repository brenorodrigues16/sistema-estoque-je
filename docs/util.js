function tratarErro(titulo, texto, icone = 'error', erroOriginal = null) {
    if (erroOriginal) console.error("Detalhe técnico:", erroOriginal);
    
    return Swal.fire({
        icon: icone,
        title: titulo,
        text: texto,
        confirmButtonColor: '#3085d6'
    });
}