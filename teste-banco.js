const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checarTabelas() {
    try {
        console.log("--- TESTE DE CONEXÃO ---");
        // Isso vai listar TODAS as tabelas que existem no banco que você conectou
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        console.log("Tabelas encontradas no banco:");
        console.table(res.rows);
        
        await pool.end();
    } catch (err) {
        console.error("ERRO AO CONECTAR:", err.message);
    }
}

checarTabelas();