/**
 * DaryWise - MongoDB Seed Script
 * Replaces schema.sql — run once to initialize collections, indexes, and seed data.
 *
 * Usage:  node seed.js
 */

const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME   = process.env.DB_NAME   || "darywise_db";

async function seed() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`[Seed] Connected to "${DB_NAME}"`);

    // ── 1. Drop existing collections for a clean seed ──────────────────────
    const existing = (await db.listCollections().toArray()).map(c => c.name);
    for (const col of ["users", "products", "transactions", "transaction_items", "topups"]) {
      if (existing.includes(col)) {
        await db.collection(col).drop();
        console.log(`[Seed] Dropped collection: ${col}`);
      }
    }

    // ── 2. Create collections with schema validation (optional but useful) ──
    await db.createCollection("users");
    await db.createCollection("products");
    await db.createCollection("transactions");
    await db.createCollection("transaction_items");
    await db.createCollection("topups");

    // ── 3. Indexes ──────────────────────────────────────────────────────────
    await db.collection("users").createIndex({ card_uid: 1 }, { unique: true });
    await db.collection("users").createIndex({ email: 1 },    { unique: true });
    await db.collection("products").createIndex({ rfid_uid: 1 }, { unique: true });
    await db.collection("transactions").createIndex({ user_id: 1 });
    await db.collection("transaction_items").createIndex({ transaction_id: 1 });
    await db.collection("topups").createIndex({ user_id: 1 });
    console.log("[Seed] Indexes created");

    // ── 4. Seed Products ────────────────────────────────────────────────────
    const products = [
      { rfid_uid: "TAG001", name: "Bottled Water",  price: 500,   stock_quantity: 50,  category: "Drink"       },
      { rfid_uid: "TAG002", name: "Sandwich",        price: 1500,  stock_quantity: 20,  category: "Food"        },
      { rfid_uid: "TAG003", name: "Energy Drink",    price: 1200,  stock_quantity: 30,  category: "Drink"       },
      { rfid_uid: "TAG004", name: "Chocolate Bar",   price: 800,   stock_quantity: 40,  category: "Food"        },
      { rfid_uid: "TAG005", name: "USB-C Cable",     price: 5000,  stock_quantity: 15,  category: "Electronics" },
      { rfid_uid: "TAG006", name: "Juice Box",       price: 700,   stock_quantity: 60,  category: "Drink"       },
      { rfid_uid: "TAG007", name: "Muffin",          price: 1000,  stock_quantity: 25,  category: "Food"        },
      { rfid_uid: "TAG008", name: "Headphones",      price: 12000, stock_quantity: 10,  category: "Electronics" },
      { rfid_uid: "TAG009", name: "T-Shirt",         price: 8000,  stock_quantity: 30,  category: "Clothing"    },
      { rfid_uid: "TAG010", name: "Notebook",        price: 2500,  stock_quantity: 45,  category: "Other"       },
      { rfid_uid: "TAG011", name: "Coffee Cups",     price: 1500,  stock_quantity: 100, category: "Other"       },
      { rfid_uid: "TAG012", name: "Soda Can",        price: 600,   stock_quantity: 80,  category: "Drink"       },
      { rfid_uid: "TAG013", name: "Banana Pack",     price: 1200,  stock_quantity: 15,  category: "Food"        },
      { rfid_uid: "TAG014", name: "Power Bank",      price: 15000, stock_quantity: 5,   category: "Electronics" },
      { rfid_uid: "TAG015", name: "Hoodie",          price: 18000, stock_quantity: 12,  category: "Clothing"    },
    ].map(p => ({ ...p, image_url: null }));

    await db.collection("products").insertMany(products);
    console.log(`[Seed] Inserted ${products.length} products`);

    // ── 5. Seed Admin User (password: admin123) ─────────────────────────────
    // Hash matches the original SQL seed: $2b$10$MUA7em.spJFshPd8O.lJnpCKp7FwEmDDi
    // Re-hash here so it's always valid regardless of bcrypt version.
    const adminHash = await bcrypt.hash("admin123", 10);

    await db.collection("users").insertOne({
      card_uid:       "ADMIN_CARD",
      fullname:       "System Admin",
      email:          "admin@darywise.com",
      password_hash:  adminHash,
      wallet_balance: 0.0,
      is_admin:       true,
      created_at:     new Date()
    });
    console.log("[Seed] Admin user created → email: admin@darywise.com  password: admin123");

    console.log("\n✅ Seed complete. DaryWise MongoDB is ready.");
  } catch (err) {
    console.error("[Seed] Error:", err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seed();