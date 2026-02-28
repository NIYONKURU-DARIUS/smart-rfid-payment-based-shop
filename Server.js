/**
 * RFID Card Top-Up System - Backend API Service
 * Team: Darius_Divine_Louise
 * Database: MongoDB (migrated from MySQL)
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mqtt = require("mqtt");
const path = require("path");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const session = require("express-session");

// ================= CONFIGURATION =================
const TEAM_ID = "Darius_Divine_Louise";
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://broker.benax.rw:1883";

// MongoDB Configuration
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.DB_NAME || "darywise_db";

let db;

async function initDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);

    // Create unique indexes to replicate SQL UNIQUE constraints
    await db.collection("users").createIndex({ card_uid: 1 }, { unique: true });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("products").createIndex({ rfid_uid: 1 }, { unique: true });

    console.log("[MongoDB] Connected to DaryWise database");
  } catch (error) {
    console.error("[MongoDB] Connection failed:", error.message);
  }
}

initDB();

// MQTT Topics
const TOPIC_STATUS  = `rfid/${TEAM_ID}/card/status`;
const TOPIC_TOPUP   = `rfid/${TEAM_ID}/card/topup`;
const TOPIC_PAY     = `rfid/${TEAM_ID}/card/pay`;
const TOPIC_BALANCE = `rfid/${TEAM_ID}/card/balance`;

// ================= EXPRESS SETUP =================
const app = express();
app.use(cors());
app.use(express.json());
app.use(session({
  secret: "darywise_secret_key",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});
app.use(express.static(__dirname));

// ================= HTTP SERVER =================
const server = http.createServer(app);

// ================= WEBSOCKET SERVER =================
const wss = new WebSocket.Server({ server });
let wsClients = new Set();

wss.on("connection", (ws) => {
  console.log(`[WebSocket] New client connected`);
  wsClients.add(ws);

  ws.send(JSON.stringify({
    event: "connection",
    message: "Connected to DaryWise Server",
    timestamp: new Date().toISOString()
  }));

  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

function broadcastToClients(data) {
  const message = JSON.stringify(data);
  let sent = 0;
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sent++;
    }
  });
  console.log(`[WebSocket] Broadcast to ${sent} client(s): ${data.event || data.type}`);
}

// ================= MQTT CLIENT =================
const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: `backend_${TEAM_ID}_${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000
});

mqttClient.on("connect", () => {
  console.log("[MQTT] Connected to broker");
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_BALANCE]);
});

mqttClient.on("message", async (topic, message) => {
  const topicStr = topic.toString();
  console.log(`[MQTT] Incoming message on topic: ${topicStr}`);

  try {
    const data = JSON.parse(message.toString());
    const { uid } = data;

    if (topicStr === TOPIC_STATUS && uid) {
      console.log(`[MQTT] PROCESSING SCAN: ${uid}`);

      let scanResult = { uid, type: "unregistered" };

      if (db) {
        // 1. Check if it's a User
        const user = await db.collection("users").findOne(
          { card_uid: uid },
          { projection: { _id: 1, card_uid: 1, fullname: 1, email: 1, wallet_balance: 1 } }
        );

        if (user) {
          scanResult = { uid, type: "user", user: { ...user, id: user._id } };
        } else {
          // 2. Check if it's a Product
          const product = await db.collection("products").findOne({ rfid_uid: uid });
          if (product) {
            scanResult = { uid, type: "product", product: { ...product, id: product._id } };
          }
        }
      }

      broadcastToClients({
        event: "rfid_scan",
        ...scanResult,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("[MQTT] Error:", error.message);
  }
});

// ================= API ENDPOINTS =================

// Register a new customer (no password needed — admin POS model)
app.post("/auth/register", async (req, res) => {
  const { uid, fullname, email } = req.body;
  try {
    const dummyHash = await bcrypt.hash("customer_no_pass_" + Date.now(), 10);

    await db.collection("users").insertOne({
      card_uid: uid,
      fullname,
      email,
      password_hash: dummyHash,
      wallet_balance: 0.0,
      is_admin: false,
      created_at: new Date()
    });

    res.json({ status: "success" });
  } catch (error) {
    console.error("[Registration Error]", error.message);
    res.status(400).json({ error: "Registration failed. Email or card UID may already be in use." });
  }
});

// Admin login
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      console.log(`[Auth] Failed login attempt for ${email}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    console.log(`[Auth] Successful login for: ${user.fullname} (Admin: ${user.is_admin})`);
    req.session.user = {
      id: user._id.toString(),
      fullname: user.fullname,
      email: user.email,
      wallet_balance: user.wallet_balance,
      isAdmin: !!user.is_admin
    };
    res.json({ status: "success", user: req.session.user });
  } catch (error) {
    console.error("[Login Error]", error.message);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/auth/user", (req, res) => {
  res.json(req.session.user || {});
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ status: "success" });
});

// Get all products
app.get("/products", async (req, res) => {
  try {
    const products = await db.collection("products").find().toArray();
    // Expose _id as id for frontend compatibility
    res.json(products.map(p => ({ ...p, id: p._id })));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// Create product (admin only)
app.post("/api/products", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { rfid_uid, name, price, stock_quantity, category } = req.body;
  try {
    await db.collection("products").insertOne({
      rfid_uid,
      name,
      price: parseFloat(price),
      stock_quantity: parseInt(stock_quantity),
      category,
      image_url: null
    });
    res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({ error: "Failed to create product" });
  }
});

// Update product (admin only)
app.put("/api/products/:id", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { id } = req.params;
  const { name, price, stock_quantity, category } = req.body;
  try {
    await db.collection("products").updateOne(
      { _id: new ObjectId(id) },
      { $set: { name, price: parseFloat(price), stock_quantity: parseInt(stock_quantity), category } }
    );
    res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update product" });
  }
});

// Delete product (admin only)
app.delete("/api/products/:id", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { id } = req.params;
  try {
    await db.collection("products").deleteOne({ _id: new ObjectId(id) });
    res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// Get transaction history (admin only)
app.get("/api/transactions", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Admin access required" });

  try {
    // MongoDB aggregation to replicate the JOIN + GROUP_CONCAT logic
    const transactions = await db.collection("transactions").aggregate([
      { $sort: { timestamp: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "transaction_items",
          localField: "_id",
          foreignField: "transaction_id",
          as: "items"
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "items.product_id",
          foreignField: "_id",
          as: "products"
        }
      },
      {
        $addFields: {
          id: "$_id",
          customer_name: "$customer.fullname",
          items_summary: {
            $reduce: {
              input: "$items",
              initialValue: "",
              in: {
                $concat: [
                  "$$value",
                  { $cond: [{ $eq: ["$$value", ""] }, "", ", "] },
                  { $toString: "$$this.quantity" },
                  "x item"
                ]
              }
            }
          }
        }
      }
    ]).toArray();

    res.json(transactions);
  } catch (error) {
    console.error("[Transactions Error]", error.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Wallet top-up (admin only)
app.post("/wallet/topup", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { userId, amount } = req.body;
  if (!userId || !amount || amount <= 0) return res.status(400).json({ error: "Invalid data" });

  try {
    const objectId = new ObjectId(userId);
    const result = await db.collection("users").findOneAndUpdate(
      { _id: objectId },
      { $inc: { wallet_balance: parseFloat(amount) } },
      { returnDocument: "after" }
    );

    await db.collection("topups").insertOne({
      user_id: objectId,
      amount: parseFloat(amount),
      method: "Dashboard",
      timestamp: new Date()
    });

    res.json({ status: "success", new_balance: result.wallet_balance });
  } catch (error) {
    console.error("[Topup Error]", error.message);
    res.status(500).json({ error: "Top-up failed" });
  }
});

// Checkout / payment
app.post("/payment/checkout", async (req, res) => {
  const { cartItems, totalAmount, cardUid } = req.body;

  let userId;

  if (cardUid) {
    const user = await db.collection("users").findOne({ card_uid: cardUid });
    if (!user) return res.status(404).json({ error: "User not found" });
    userId = user._id;
  } else if (req.session.user) {
    userId = new ObjectId(req.session.user.id);
  } else {
    return res.status(401).json({ error: "Identification required (Login or Tap Card)" });
  }

  // MongoDB does not have native transactions without a replica set,
  // but we use a session-based transaction if available, otherwise sequential ops.
  const mongoSession = db.client ? db.client.startSession() : null;

  try {
    if (mongoSession) mongoSession.startTransaction();

    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) throw new Error("User not found");

    console.log(`[Checkout] Processing for ${user.fullname}. Total: ${totalAmount}. Balance: ${user.wallet_balance}`);

    if (user.wallet_balance < totalAmount) {
      throw new Error("Insufficient balance on customer card");
    }

    // Insert transaction
    const txResult = await db.collection("transactions").insertOne({
      user_id: userId,
      total_amount: parseFloat(totalAmount),
      status: "PAID",
      timestamp: new Date()
    });

    // Process each cart item
    for (const item of cartItems) {
      const productId = new ObjectId(item.id);

      await db.collection("transaction_items").insertOne({
        transaction_id: txResult.insertedId,
        product_id: productId,
        quantity: item.quantity,
        unit_price: parseFloat(item.price)
      });

      await db.collection("products").updateOne(
        { _id: productId },
        { $inc: { stock_quantity: -item.quantity } }
      );
    }

    // Deduct from wallet
    const updated = await db.collection("users").findOneAndUpdate(
      { _id: userId },
      { $inc: { wallet_balance: -parseFloat(totalAmount) } },
      { returnDocument: "after" }
    );

    if (mongoSession) await mongoSession.commitTransaction();

    console.log(`[Checkout] Success for ${user.fullname}. New Balance: ${updated.wallet_balance}`);

    mqttClient.publish(TOPIC_PAY, JSON.stringify({ type: "checkout", amount: totalAmount, user: user.fullname }));

    res.json({
      status: "success",
      new_balance: updated.wallet_balance,
      customerName: user.fullname
    });
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("[Checkout Error]", error.message);
    res.status(400).json({ error: error.message });
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 DaryWise Server running at http://localhost:${PORT}`);
});