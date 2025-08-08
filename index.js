const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer'); // Para lidar com uploads de arquivos
const path = require('path'); // Para manipular caminhos de arquivos
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuração do multer para salvar imagens na pasta 'uploads'
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads'); // Pasta onde as imagens serão salvas
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop()); // Nome único para o arquivo
  }
});

const upload = multer({ storage: storage });

// Configuração do banco de dados
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('Conexão com PostgreSQL estabelecida!');
    client.release();
  } catch (error) {
    console.error('Erro ao conectar ao PostgreSQL:', error.message, error.stack);
  }
})();

// Middleware de autenticação
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('Header de autenticação recebido:', authHeader); // Log para debug
  if (!authHeader) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1]; // Espera "Bearer <token>"
  if (!token) {
    return res.status(401).json({ error: 'Formato de token inválido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token decodificado no backend:', decoded); // Log para debug detalhado
    req.user = decoded; // Adiciona id e role ao req
    next();
  } catch (error) {
    console.error('Erro ao verificar token:', error.message, error.stack);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

// Middleware para verificar papel específico ou admin
const checkAdminOrRole = (role) => {
  return (req, res, next) => {
    console.log('Verificando papel específico ou admin no backend:', { expectedRole: role, userRole: req.user.role }); // Log para debug detalhado
    if (req.user.role === 'admin' || req.user.role === role) {
      next();
    } else {
      return res.status(403).json({ error: `Apenas ${role}s ou administradores podem acessar esta rota` });
    }
  };
};

// Middleware para verificar apenas admin (usado onde só admin deve acessar)
const checkAdminOnly = (req, res, next) => {
  console.log('Verificando apenas admin no backend:', req.user.role); // Log para debug
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem acessar esta rota' });
  }
  next();
};

// Rota de Registro
app.post('/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email, hashedPassword, role || 'comprador']
    );
    console.log('Usuário registrado:', result.rows[0]); // Log para debug
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao registrar:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

// Rota de Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Senha inválida' });
    }
    const token = jwt.sign(
      { id: user.id, role: user.role }, // Certifique-se de que role está correto
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('Token gerado para login:', token); // Log para debug
    console.log('Usuário logado:', { id: user.id, role: user.role }); // Log para debug
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    console.error('Erro ao fazer login:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// Rota protegida de teste
app.get('/protected', authenticate, (req, res) => {
  console.log('Acesso à rota protegida por:', req.user); // Log para debug
  res.json({ message: 'Você está autenticado!', user: req.user });
});

// Produtos (Vendedores)
// Adicionar produtos com upload de imagem (somente vendedores ou admin)
app.post('/products/upload', authenticate, checkAdminOrRole('vendedor'), upload.single('image'), async (req, res) => {
  const { name, description, price, stock } = req.body;
  try {
    if (!name || !price || !stock) {
      return res.status(400).json({ error: 'Nome, preço e estoque são obrigatórios' });
    }
    console.log('Dados recebidos para adicionar produto:', { name, description, price, stock, file: req.file }); // Log para debug
    const imagePath = req.file ? `uploads/${req.file.filename}` : null; // Caminho relativo da imagem
    const result = await pool.query(
      'INSERT INTO products (seller_id, name, description, price, stock, imageurl) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.id, name, description, price, stock, imagePath]
    );
    console.log('Produto adicionado:', result.rows[0]); // Log para debug
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao adicionar produto:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

// Rota para obter um produto específico (somente vendedores ou admin)
app.get('/products/:id', authenticate, checkAdminOrRole('vendedor'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1 AND seller_id = $2', [id, req.user.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado ou você não tem permissão' });
    }
    // Retornar apenas o caminho relativo
    const product = result.rows[0];
    console.log('Produto retornado para vendedor ou admin:', product); // Log para debug
    res.json(product);
  } catch (error) {
    console.error('Erro ao buscar produto:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

// Editar produto com opção de nova imagem (somente o vendedor dono do produto ou admin)
app.put('/products/:id', authenticate, checkAdminOrRole('vendedor'), upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, description, price, stock } = req.body;
  try {
    const productResult = await pool.query('SELECT * FROM products WHERE id = $1 AND seller_id = $2', [id, req.user.id]);
    if (!productResult.rows.length) {
      return res.status(403).json({ error: 'Produto não encontrado ou você não tem permissão' });
    }
    let imagePath = productResult.rows[0].imageurl;
    if (req.file) {
      // Se uma nova imagem for enviada, atualize o caminho
      imagePath = `uploads/${req.file.filename}`;
      // Opcional: Remover a imagem antiga, se necessário
      // const fs = require('fs');
      // if (fs.existsSync(imagePath)) {
      //   fs.unlinkSync(imagePath);
      // }
    }
    const result = await pool.query(
      'UPDATE products SET name = $1, description = $2, price = $3, stock = $4, imageurl = $5 WHERE id = $6 RETURNING *',
      [name, description, price, stock, imagePath, id]
    );
    console.log('Produto editado:', result.rows[0]); // Log para debug
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao editar produto:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao editar produto' });
  }
});

// Remover produto (somente o vendedor dono do produto ou admin)
app.delete('/products/:id', authenticate, checkAdminOrRole('vendedor'), async (req, res) => {
  const { id } = req.params;
  try {
    const productResult = await pool.query('SELECT * FROM products WHERE id = $1 AND seller_id = $2', [id, req.user.id]);
    if (!productResult.rows.length) {
      return res.status(403).json({ error: 'Produto não encontrado ou você não tem permissão' });
    }
    const imagePath = productResult.rows[0].imageurl;
    // Opcional: Remover a imagem do sistema de arquivos
    // const fs = require('fs');
    // if (imagePath && fs.existsSync(imagePath)) {
    //   fs.unlinkSync(imagePath);
    // }
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    console.log('Produto removido por vendedor ou admin:', { id }); // Log para debug
    res.json({ message: 'Produto removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover produto:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao remover produto' });
  }
});

// Listar produtos (pública, acessível para todos, incluindo clientes)
app.get('/products', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const search = req.query.search || '';
    const priceFilter = req.query.priceFilter || 'all';
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM products WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) FROM products WHERE 1=1';
    const params = [];
    const countParams = [];

    if (search) {
      query += ' AND (name ILIKE $1 OR description ILIKE $1)';
      countQuery += ' AND (name ILIKE $1 OR description ILIKE $1)';
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    if (priceFilter !== 'all') {
      let priceCondition;
      if (priceFilter === 'low') priceCondition = 'price <= 100';
      else if (priceFilter === 'medium') priceCondition = 'price > 100 AND price <= 200';
      else if (priceFilter === 'high') priceCondition = 'price > 200';
      query += ` AND ${priceCondition}`;
      countQuery += ` AND ${priceCondition}`;
    }

    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const totalResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(totalResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      products: result.rows,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error('Erro ao listar produtos:', error.message);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

// Listar produtos do vendedor logado (somente vendedores ou admin)
app.get('/seller/products', authenticate, checkAdminOrRole('vendedor'), async (req, res) => {
  try {
    const sellerId = req.user.id; // Obtido do middleware authenticate
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;

    const query = 'SELECT * FROM products WHERE seller_id = $1 LIMIT $2 OFFSET $3';
    const countQuery = 'SELECT COUNT(*) FROM products WHERE seller_id = $1';
    const params = [sellerId, limit, offset];
    const countParams = [sellerId];

    const result = await pool.query(query, params);
    const totalResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(totalResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    console.log('Produtos do vendedor retornados:', result.rows); // Log para debug
    res.json({
      products: result.rows,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error('Erro ao listar produtos do vendedor:', error.message);
    res.status(500).json({ error: 'Erro ao listar produtos do vendedor' });
  }
});

// Listar todos os produtos (somente para admin e vendedor)
app.get('/products/all', authenticate, checkAdminOrRole('vendedor'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    console.log('Query SQL executada para todos os produtos:', 'SELECT * FROM products');
    console.log('Todos os produtos retornados antes do ajuste (raw):', result.rows); // Log detalhado
    if (result.rows.length === 0) {
      console.warn('Nenhum produto encontrado no banco de dados.');
    }
    // Retornar apenas o caminho relativo
    const products = result.rows.map(product => ({
      ...product,
    }));
    console.log('Todos os produtos retornados após ajuste:', products); // Log após ajuste
    res.json(products);
  } catch (error) {
    console.error('Erro ao listar todos os produtos:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao listar todos os produtos' });
  }
});

// Listar avaliações de um produto específico (acesso público, mas com autenticação para segurança)
app.get('/products/:id/reviews', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT r.rating, r.comment, u.username, r.created_at AS date FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.product_id = $1 ORDER BY r.created_at DESC',
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar avaliações:', error);
    res.status(500).json({ error: 'Erro ao listar avaliações' });
  }
});

// Adicionar uma nova avaliação (somente para compradores)
app.post('/products/:id/reviews', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;
  const userId = req.user.id; // Obtido do middleware authenticate

  try {
    // Verificar se o produto existe
    const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (!productResult.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Inserir a avaliação
    await pool.query(
      'INSERT INTO reviews (product_id, user_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [id, userId, rating, comment]
    );
    res.json({ message: 'Avaliação adicionada com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar avaliação:', error);
    res.status(500).json({ error: 'Erro ao adicionar avaliação' });
  }
});

app.get('/wishlist', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  const userId = req.user.id; // Obtido do middleware authenticate
  try {
    const result = await pool.query(
      'SELECT p.* FROM wishlist w JOIN products p ON w.product_id = p.id WHERE w.user_id = $1',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar itens da lista de desejos:', error);
    res.status(500).json({ error: 'Erro ao listar itens da lista de desejos' });
  }
});

// Adicionar um produto à lista de desejos (somente para compradores)
app.post('/wishlist', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  const { product_id } = req.body;
  const userId = req.user.id; // Obtido do middleware authenticate

  try {
    // Verificar se o produto existe
    const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (!productResult.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Verificar se o item já está na lista de desejos
    const existingWishlist = await pool.query(
      'SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2',
      [userId, product_id]
    );
    if (existingWishlist.rows.length > 0) {
      return res.status(400).json({ error: 'Produto já está na lista de desejos' });
    }

    // Inserir na lista de desejos
    await pool.query(
      'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2)',
      [userId, product_id]
    );
    res.json({ message: 'Produto adicionado à lista de desejos com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar à lista de desejos:', error);
    res.status(500).json({ error: 'Erro ao adicionar à lista de desejos' });
  }
});

// Remover um produto da lista de desejos (somente para compradores)
app.delete('/wishlist/:id', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  const { id } = req.params; // ID do produto
  const userId = req.user.id; // Obtido do middleware authenticate

  try {
    const result = await pool.query(
      'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2 RETURNING *',
      [userId, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado na lista de desejos' });
    }
    res.json({ message: 'Produto removido da lista de desejos com sucesso' });
  } catch (error) {
    console.error('Erro ao remover da lista de desejos:', error);
    res.status(500).json({ error: 'Erro ao remover da lista de desejos' });
  }
});

// Pedidos (Compradores)
// Criar pedido (somente compradores ou admin)
app.post('/orders', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  const { products } = req.body; // Espera um array de { product_id, quantity }
  try {
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Produtos são obrigatórios e devem ser um array' });
    }

    let total = 0;
    const productDetails = [];

    // Verificar produtos e calcular total
    for (const item of products) {
      const { product_id, quantity } = item;
      if (!product_id || !quantity) {
        return res.status(400).json({ error: 'Cada produto deve ter ID e quantidade' });
      }
      const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
      const product = productResult.rows[0];
      if (!product || product.stock < quantity) {
        return res.status(400).json({ error: `Produto ${product_id} não disponível ou estoque insuficiente` });
      }
      total += product.price * quantity;
      productDetails.push({ product_id, quantity, price: product.price });
    }

    // Criar o pedido
    const orderResult = await pool.query(
      'INSERT INTO orders (buyer_id, total, status) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, total, 'pendente']
    );
    const order = orderResult.rows[0];

    // Adicionar itens do pedido
    for (const item of productDetails) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [order.id, item.product_id, item.quantity, item.price]
      );
    }

    // Atualizar estoque dos produtos
    for (const item of productDetails) {
      await pool.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    console.log('Pedido criado por comprador ou admin:', order); // Log para debug
    res.status(201).json(order);
  } catch (error) {
    console.error('Erro ao criar pedido:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

// Listar pedidos do comprador (somente compradores ou admin)
app.get('/orders', authenticate, checkAdminOrRole('comprador'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    console.log('Pedidos retornados para comprador ou admin:', result.rows); // Log para debug
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar pedidos:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao listar pedidos' });
  }
});

// Admin
// Listar todos os usuários (somente admin)
app.get('/users', authenticate, checkAdminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, role FROM users');
    console.log('Query SQL executada para usuários:', 'SELECT id, username, email, role FROM users');
    console.log('Usuários retornados para admin (raw):', result.rows); // Log detalhado
    if (result.rows.length === 0) {
      console.warn('Nenhum usuário encontrado no banco de dados.');
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar usuários (admin):', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao listar usuários (admin)' });
  }
});

// Remover usuário (somente admin)
app.delete('/users/:id', authenticate, checkAdminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    // Verificar se o usuário existe
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se o usuário tem produtos associados (apenas para vendedores)
    const productsResult = await pool.query('SELECT * FROM products WHERE seller_id = $1', [id]);
    if (productsResult.rows.length > 0) {
      console.log('Usuário tem produtos associados, removendo produtos antes da exclusão:', productsResult.rows);
      // Remover todos os produtos associados ao vendedor
      for (const product of productsResult.rows) {
        const imagePath = product.imageurl;
        if (imagePath) {
          // Opcional: Remover a imagem do sistema de arquivos
          // const fs = require('fs');
          // if (fs.existsSync(imagePath)) {
          //   fs.unlinkSync(imagePath);
          // }
        }
        await pool.query('DELETE FROM order_items WHERE product_id = $1', [product.id]); // Remover itens de pedidos relacionados
        await pool.query('DELETE FROM products WHERE id = $1', [product.id]); // Remover o produto
      }
    }

    // Remover o usuário
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    console.log('Usuário removido:', { id }); // Log para debug
    res.json({ message: 'Usuário removido com sucesso (produtos associados, se houver, também foram removidos)' });
  } catch (error) {
    console.error('Erro ao remover usuário:', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao remover usuário' });
  }
});

// Listar todos os produtos (somente admin)
app.get('/products/admin', authenticate, checkAdminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    console.log('Query SQL executada para produtos admin:', 'SELECT * FROM products');
    console.log('Produtos retornados para admin antes do ajuste (raw):', result.rows); // Log detalhado
    if (result.rows.length === 0) {
      console.warn('Nenhum produto encontrado no banco de dados.');
    }
    // Ajustar imageurl para o caminho correto
    const products = result.rows.map(product => ({
      ...product,
      imageurl: product.imageurl ? `http://localhost:5000/uploads/${product.imageurl.replace(/^uploads\//, '')}` : null,
    }));
    console.log('Produtos retornados para admin após ajuste:', products); // Log após ajuste
    res.json(products);
  } catch (error) {
    console.error('Erro ao listar produtos (admin):', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao listar produtos (admin)' });
  }
});

// Remover produto (somente admin)
app.delete('/products/admin/:id', authenticate, checkAdminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    // Remover itens relacionados em order_items primeiro
    await pool.query('DELETE FROM order_items WHERE product_id = $1', [id]);
    // Remover o produto
    const productResult = await pool.query('SELECT imageurl FROM products WHERE id = $1', [id]);
    const imagePath = productResult.rows[0]?.imageurl;
    if (imagePath) {
      // Opcional: Remover a imagem do sistema de arquivos
      // const fs = require('fs');
      // if (fs.existsSync(imagePath)) {
      //   fs.unlinkSync(imagePath);
      // }
    }
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    console.log('Produto removido por admin:', { id }); // Log para debug
    res.json({ message: 'Produto removido com sucesso (admin)' });
  } catch (error) {
    console.error('Erro ao remover produto (admin):', error.message, error.stack);
    res.status(500).json({ error: 'Erro ao remover produto (admin)' });
  }
});

// Servir arquivos estáticos da pasta 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Backend funcionando!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});