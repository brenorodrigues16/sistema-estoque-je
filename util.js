function tratarErro(msgUsuario, erroOriginal = null) {
    if (erroOriginal) console.error("Detalhe do erro:", erroOriginal);
    Swal.fire({
        icon: 'error',
        title: 'Ops!',
        text: msgUsuario,
        confirmButtonColor: '#3085d6'
    });
}