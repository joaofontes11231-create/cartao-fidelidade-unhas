const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Pega a senha e o banco de dados das variáveis de ambiente ou usa valores padrão para teste
const SENHA_ADMIN = process.env.SENHA_ADMIN || "123456"; 
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fidelidade';

// Conexão com o Banco de Dados
mongoose.connect(MONGO_URI)
    .then(() => console.log('Banco de dados conectado na nuvem com sucesso!'))
    .catch(err => console.log('Erro ao conectar no banco:', err));

// Modelo do Cliente no Banco
const Cliente = mongoose.model('Cliente', {
    telefone: String,
    nome: String,
    coracoes: { type: Number, default: 0 },
    maxCoracoes: { type: Number, default: 10 }
});

// Rota de Login da Dona
app.post('/api/login', (req, res) => {
    const { senha } = req.body;
    if (senha === SENHA_ADMIN) {
        res.json({ sucesso: true });
    } else {
        res.status(401).json({ sucesso: false, erro: 'Senha incorreta!' });
    }
});

// Buscar cliente
app.get('/api/cliente/:telefone', async (req, res) => {
    let cliente = await Cliente.findOne({ telefone: req.params.telefone });
    if (!cliente) {
        cliente = new Cliente({ telefone: req.params.telefone, nome: 'Cliente', coracoes: 0 });
        await cliente.save();
    }
    res.json(cliente);
});

// Cadastrar ou atualizar nome
app.post('/api/cadastrar', async (req, res) => {
    const { telefone, nome } = req.body;
    let cliente = await Cliente.findOne({ telefone });
    
    if (!cliente) {
        cliente = new Cliente({ telefone, nome, coracoes: 0 });
    } else {
        cliente.nome = nome;
    }
    await cliente.save();
    res.json(cliente);
});

// Adicionar ou remover corações
app.post('/api/atualizar', async (req, res) => {
    const { telefone, acao } = req.body;
    let cliente = await Cliente.findOne({ telefone });

    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    if (acao === 'adicionar' && cliente.coracoes < cliente.maxCoracoes) {
        cliente.coracoes += 1;
    } else if (acao === 'remover' && cliente.coracoes > 0) {
        cliente.coracoes -= 1;
    }

    await cliente.save();
    res.json(cliente);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}!`));