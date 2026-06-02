require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Configure igual ao seu server.js
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function migrarSenhas() {
    try {
        const usuarios = await pool.query('SELECT id, senha FROM usuarios');
        
        for (let user of usuarios.rows) {
            // Verifica se a senha já não é um hash (para não rodar duas vezes)
            if (!user.senha.startsWith('$2b$')) {
                const hash = await bcrypt.hash(user.senha, 10);
                await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [hash, user.id]);
                console.log(`Senha do usuário ${user.id} migrada com sucesso!`);
            }
        }
        console.log("Migração concluída!");
    } catch (err) {
        console.error("Erro na migração:", err);
    } finally {
        process.exit();
    }
}

migrarSenhas();