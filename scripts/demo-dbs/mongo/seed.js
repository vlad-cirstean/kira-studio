// Kira Studio — MongoDB seed data (idempotent)
// Run: docker exec -i kira-mongo mongosh kira < scripts/mongo/seed.js
// ~20k docs per collection, exercising many BSON types.

db = db.getSiblingDB('kira');

const N = 20000;
const batch = 1000;

function chunkInsert(coll, docs) {
  for (let i = 0; i < docs.length; i += batch) {
    coll.insertMany(docs.slice(i, i + batch), { ordered: false });
  }
}

function hexId(i) {
  return new ObjectId('0000000000000000000' + i.toString(16).padStart(5, '0'));
}

const tiers = ['bronze', 'silver', 'gold', 'platinum'];
const tagsPool = ['vip', 'new', 'returning', 'whale'];
const cities = ['Berlin', 'London', 'Paris', 'Tokyo', 'New York', 'Sydney', 'Toronto', 'Madrid'];
const countries = ['US', 'DE', 'GB', 'FR', 'JP', 'AU', 'CA', 'ES'];

print('Clearing collections...');
db.customers.deleteMany({});
db.addresses.deleteMany({});
db.categories.deleteMany({});
db.products.deleteMany({});
db.orders.deleteMany({});
db.orderItems.deleteMany({});
db.reviews.deleteMany({});

// ---------------------------------------------------------------------------
// customers — 20,000
// ---------------------------------------------------------------------------
print('Seeding customers...');
const customerIds = [];
{
  const docs = [];
  for (let i = 1; i <= N; i++) {
    const _id = hexId(i);
    customerIds.push(_id);
    docs.push({
      _id,
      email: `user${i}@example.com`,
      fullName: `Customer ${i}`,
      nickname: `nick${i}`,
      salutation: ['Mr.', 'Ms.', 'Dr.', 'Mx.'][i % 4],
      isActive: i % 7 !== 0,
      balance: Math.round(Math.random() * 10000000) / 100,
      creditLimit: NumberDecimal((Math.random() * 5000).toFixed(2)),
      loyaltyPoints: Int32(Math.floor(Math.random() * 10000)),
      lifetimeValue: Math.random() * 100000,
      discountRate: Math.round(Math.random() * 30) / 100,
      birthDate: new Date(Date.UTC(1950, 0, 1) + Math.floor(Math.random() * 26000) * 86400000),
      signupAt: new Date(Date.UTC(2015, 0, 1) + Math.floor(Math.random() * 300000000) * 1000),
      lastSeen: new Date(Date.UTC(2023, 0, 1) + Math.floor(Math.random() * 50000000) * 1000),
      avatar: BinData(0, (i % 256).toString(16).padStart(2, '0').repeat(16)),
      profile: {
        tier: tiers[i % 4],
        prefs: { newsletter: i % 2 === 0 },
        visits: Math.floor(Math.random() * 500),
      },
      tags: [tagsPool[i % 4], cities[i % 8].slice(0, 3)],
      luckyNumbers: [i % 100, (i * 3) % 100, (i * 7) % 100],
      ip: `10.0.${i % 255}.${i % 250}`,
      uuid: UUID().toString(),
      location: { type: 'Point', coordinates: [(i % 360) - 180, (i % 180) - 90] },
      bio: `Bio for customer ${i}`,
    });
  }
  chunkInsert(db.customers, docs);
}

// ---------------------------------------------------------------------------
// addresses — 20,000
// ---------------------------------------------------------------------------
print('Seeding addresses...');
const addressIds = [];
{
  const docs = [];
  for (let i = 1; i <= N; i++) {
    const _id = hexId(i + N);
    addressIds.push(_id);
    docs.push({
      _id,
      customerId: customerIds[i - 1],
      label: ['home', 'work', 'billing', 'shipping'][i % 4],
      street: `${i % 9999} Main St`,
      city: cities[i % 8],
      region: ['CA', 'NY', 'TX', 'BW', 'ENG', 'IDF', 'NSW', 'ON'][i % 8],
      postalCode: String(i % 99999).padStart(5, '0'),
      country: countries[i % 8],
      isDefault: i % 5 === 0,
      phone: `+1-555-${String(i % 10000).padStart(4, '0')}`,
      createdAt: new Date(Date.UTC(2015, 0, 1) + Math.floor(Math.random() * 300000000) * 1000),
    });
  }
  chunkInsert(db.addresses, docs);
}

// ---------------------------------------------------------------------------
// categories — 20,000 (self-referencing)
// ---------------------------------------------------------------------------
print('Seeding categories...');
const categoryIds = [];
{
  const docs = [];
  for (let i = 1; i <= N; i++) {
    const _id = hexId(i + 2 * N);
    categoryIds.push(_id);
    docs.push({
      _id,
      parentId: i % 17 === 0 ? null : categoryIds[i - 2 - (i % 16)],
      name: `Category ${i}`,
      slug: `category-${i}`,
      description: `Description for category ${i}`,
      sortOrder: i % 100,
      createdAt: new Date(Date.UTC(2015, 0, 1) + Math.floor(Math.random() * 300000000) * 1000),
    });
  }
  chunkInsert(db.categories, docs);
}

// ---------------------------------------------------------------------------
// products — 20,000
// ---------------------------------------------------------------------------
print('Seeding products...');
const productIds = [];
{
  const docs = [];
  const colors = ['red', 'blue', 'green', 'black', 'white'];
  const sizes = ['S', 'M', 'L', 'XL'];
  for (let i = 1; i <= N; i++) {
    const _id = hexId(i + 3 * N);
    productIds.push(_id);
    const categoryRef = i % 20 === 0 ? null : categoryIds[(i * 37) % N];
    docs.push({
      _id,
      categoryId: categoryRef,
      sku: `SKU-${String(i).padStart(6, '0')}`,
      name: `Product ${i}`,
      description: `Short description for product ${i}`,
      longDesc: `Long description for product ${i}. `.repeat(5),
      price: NumberDecimal((Math.random() * 5000 + 1).toFixed(2)),
      oldPrice: NumberDecimal((Math.random() * 6000 + 1).toFixed(2)),
      cost: NumberDecimal((Math.random() * 3000 + 1).toFixed(2)),
      weightGrams: Int32(Math.floor(Math.random() * 50000)),
      volumeMl: Int32(Math.floor(Math.random() * 2000)),
      weightLbs: Math.round(Math.random() * 50) / 10,
      stock: Int32(Math.floor(Math.random() * 10000)),
      reorderLevel: Int32(Math.floor(Math.random() * 50)),
      rating: Math.round(Math.random() * 500) / 100,
      reviewCount: Int32(Math.floor(Math.random() * 5000)),
      isFeatured: i % 10 === 0,
      isPublished: i % 50 !== 0,
      availableFrom: new Date(Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 2000) * 86400000),
      leadTimeDays: Int32(Math.floor(Math.random() * 30)),
      attributes: {
        color: colors[i % 5],
        size: sizes[i % 4],
        material: ['cotton', 'steel', 'wood', 'glass'][i % 4],
      },
      images: [`img/${i}-1.jpg`, `img/${i}-2.jpg`],
      location: { type: 'Point', coordinates: [(i % 360) - 180, (i % 180) - 90] },
    });
  }
  chunkInsert(db.products, docs);
}

// ---------------------------------------------------------------------------
// orders — 20,000
// ---------------------------------------------------------------------------
print('Seeding orders...');
const orderIds = [];
{
  const docs = [];
  const statuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  for (let i = 1; i <= N; i++) {
    const _id = hexId(i + 4 * N);
    orderIds.push(_id);
    docs.push({
      _id,
      customerId: customerIds[(i * 37) % N],
      addressId: addressIds[(i * 17) % N],
      reference: UUID().toString(),
      status: statuses[i % 5],
      total: NumberDecimal((Math.random() * 10000).toFixed(2)),
      discount: NumberDecimal((Math.random() * 500).toFixed(2)),
      tax: NumberDecimal((Math.random() * 1000).toFixed(2)),
      placedAt: new Date(Date.UTC(2021, 0, 1) + Math.floor(Math.random() * 150000000) * 1000),
      updatedAt: new Date(Date.UTC(2021, 0, 1) + Math.floor(Math.random() * 150000000) * 1000),
      shippedAt:
        i % 3 === 0
          ? null
          : new Date(Date.UTC(2021, 0, 1) + Math.floor(Math.random() * 150000000) * 1000),
      notes: i % 4 === 0 ? `note ${i}` : null,
    });
  }
  chunkInsert(db.orders, docs);
}

// ---------------------------------------------------------------------------
// orderItems — 80,000 (4 per order)
// ---------------------------------------------------------------------------
print('Seeding orderItems...');
{
  const docs = [];
  for (let i = 1; i <= N * 4; i++) {
    docs.push({
      orderId: orderIds[(i - 1) % N],
      productId: productIds[(i * 7919) % N],
      quantity: Int32((i % 5) + 1),
      unitPrice: NumberDecimal((Math.random() * 5000 + 1).toFixed(2)),
      lineTotal: NumberDecimal((Math.random() * 1000 + 10).toFixed(2)),
      skuSnapshot: `SKU-${String(((i * 7919) % N) + 1).padStart(6, '0')}`,
    });
  }
  chunkInsert(db.orderItems, docs);
}

// ---------------------------------------------------------------------------
// reviews — 20,000 (unique product/customer pairs)
// ---------------------------------------------------------------------------
print('Seeding reviews...');
{
  const docs = [];
  for (let i = 1; i <= N; i++) {
    docs.push({
      productId: productIds[i - 1],
      customerId: customerIds[(i * 7919) % N],
      rating: Int32((i % 5) + 1),
      title: `Review ${i}`,
      body: `This is the body of review ${i}`,
      helpful: Int32(Math.floor(Math.random() * 1000)),
      createdAt: new Date(Date.UTC(2022, 0, 1) + Math.floor(Math.random() * 100000000) * 1000),
    });
  }
  chunkInsert(db.reviews, docs);
}

print('Done.');
print(`customers: ${db.customers.countDocuments()}`);
print(`addresses: ${db.addresses.countDocuments()}`);
print(`categories: ${db.categories.countDocuments()}`);
print(`products: ${db.products.countDocuments()}`);
print(`orders: ${db.orders.countDocuments()}`);
print(`orderItems: ${db.orderItems.countDocuments()}`);
print(`reviews: ${db.reviews.countDocuments()}`);
