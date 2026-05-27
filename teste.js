const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'breno.rodriguesdednow@gmail.com',
        pass: 'upxhdfhchxlozsip' 
    }
});

console.log("Tentando enviar e-mail de teste...");

transporter.sendMail({
    from: 'breno.rodriguesdednow@gmail.com',
    to: 'breno.rodriguesdednow@gmail.com',
    subject: 'Teste Direto do VS Code',
    text: 'Se você recebeu isso, o VS Code ESTÁ ENVIANDO e-mail!'
}, (err, info) => {
    if (err) {
        console.log("❌ Erro detectado:", err);
    } else {
        console.log("✅ FUNCIONOU! E-mail enviado:", info.response);
    }
});