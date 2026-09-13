// Kira Studio — MongoDB schema: collections, validators, indexes
// Database: kira  (no auth)

db = db.getSiblingDB('kira');

// ---------------------------------------------------------------------------
// collections
// ---------------------------------------------------------------------------
db.createCollection('customers', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'fullName'],
      properties: {
        email: { bsonType: 'string' },
        fullName: { bsonType: 'string' },
      },
    },
  },
});

db.createCollection('addresses');
db.createCollection('categories');
db.createCollection('products');
db.createCollection('orders');
db.createCollection('orderItems');
db.createCollection('reviews');

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------
db.customers.createIndex({ email: 1 }, { unique: true, name: 'uq_customers_email' });
db.customers.createIndex({ fullName: 1 }, { name: 'idx_customers_fullName' });
db.customers.createIndex({ balance: -1 }, { name: 'idx_customers_balance' });
db.customers.createIndex({ tags: 1 }, { name: 'idx_customers_tags' });
db.customers.createIndex({ signupAt: -1 }, { name: 'idx_customers_signupAt' });
db.customers.createIndex({ fullName: 'text', bio: 'text' }, { name: 'idx_customers_text' });

// ---------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------
db.addresses.createIndex({ customerId: 1 }, { name: 'idx_addresses_customer' });
db.addresses.createIndex({ city: 1 }, { name: 'idx_addresses_city' });

// ---------------------------------------------------------------------------
// categories (self-referencing)
// ---------------------------------------------------------------------------
db.categories.createIndex({ slug: 1 }, { unique: true, name: 'uq_categories_slug' });
db.categories.createIndex({ parentId: 1 }, { name: 'idx_categories_parent' });

// ---------------------------------------------------------------------------
// products
// ---------------------------------------------------------------------------
db.products.createIndex({ sku: 1 }, { unique: true, name: 'uq_products_sku' });
db.products.createIndex({ categoryId: 1 }, { name: 'idx_products_category' });
db.products.createIndex({ price: -1 }, { name: 'idx_products_price' });
db.products.createIndex({ name: 'text', description: 'text' }, { name: 'idx_products_text' });
db.products.createIndex({ location: '2dsphere' }, { name: 'idx_products_geo' });
db.products.createIndex({ attributes: 1 }, { name: 'idx_products_attributes' });

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------
db.orders.createIndex({ customerId: 1 }, { name: 'idx_orders_customer' });
db.orders.createIndex({ status: 1 }, { name: 'idx_orders_status' });
db.orders.createIndex({ placedAt: -1 }, { name: 'idx_orders_placedAt' });
db.orders.createIndex({ customerId: 1, status: 1 }, { name: 'idx_orders_customer_status' });

// ---------------------------------------------------------------------------
// orderItems
// ---------------------------------------------------------------------------
db.orderItems.createIndex({ orderId: 1 }, { name: 'idx_orderItems_order' });
db.orderItems.createIndex({ productId: 1 }, { name: 'idx_orderItems_product' });
db.orderItems.createIndex({ orderId: 1, productId: 1 }, { name: 'idx_orderItems_order_product' });

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------
db.reviews.createIndex({ productId: 1 }, { name: 'idx_reviews_product' });
db.reviews.createIndex({ customerId: 1 }, { name: 'idx_reviews_customer' });
db.reviews.createIndex({ rating: 1 }, { name: 'idx_reviews_rating' });
db.reviews.createIndex(
  { productId: 1, customerId: 1 },
  { unique: true, name: 'uq_reviews_product_customer' },
);
