import type { DataSource } from 'typeorm';
import { ProductOrmEntity } from '../../catalog/infrastructure/typeorm/product.entity';

export const catalogProducts: Pick<
  ProductOrmEntity,
  | 'id'
  | 'sku'
  | 'name'
  | 'category'
  | 'description'
  | 'imageUrl'
  | 'unitPriceCents'
  | 'currency'
  | 'stock'
  | 'active'
>[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'AUD-001',
    name: 'Auriculares inalámbricos Nova',
    category: 'audio',
    description:
      'Auriculares Bluetooth con micrófono integrado, controles táctiles y estuche de carga USB-C. Diseño compacto para llamadas, música y uso diario. Incluyen cable de carga y almohadillas.',
    imageUrl: 'https://placehold.co/800x600/png?text=Auriculares',
    unitPriceCents: 12990000,
    currency: 'COP',
    stock: 10,
    active: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'AUD-002',
    name: 'Parlante portátil Pulse',
    category: 'audio',
    description:
      'Parlante Bluetooth portátil de 20 W con conexión auxiliar, controles físicos y carga USB-C. Su formato compacto permite moverlo entre espacios del hogar. Incluye cable de carga.',
    imageUrl: 'https://placehold.co/800x600/png?text=Parlante',
    unitPriceCents: 17990000,
    currency: 'COP',
    stock: 5,
    active: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    sku: 'COM-001',
    name: 'Teclado mecánico K68',
    category: 'computacion',
    description:
      'Teclado mecánico compacto de 68 teclas, distribución en español y conexión USB-C por cable. Cuenta con retroiluminación y patas ajustables. Incluye cable USB.',
    imageUrl: 'https://placehold.co/800x600/png?text=Teclado',
    unitPriceCents: 18990000,
    currency: 'COP',
    stock: 12,
    active: true,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    sku: 'COM-002',
    name: 'Mouse inalámbrico Ergo',
    category: 'computacion',
    description:
      'Mouse de diseño ergonómico para mano derecha, conexión inalámbrica mediante receptor USB y sensibilidad ajustable. Incluye botones laterales y receptor USB.',
    imageUrl: 'https://placehold.co/800x600/png?text=Mouse',
    unitPriceCents: 7990000,
    currency: 'COP',
    stock: 18,
    active: true,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    sku: 'COM-003',
    name: 'Cámara web Full HD Focus',
    category: 'computacion',
    description:
      'Cámara web de resolución 1080p con micrófono integrado, conexión USB y cubierta física de privacidad. Incluye soporte ajustable para monitor y base para escritorio.',
    imageUrl: 'https://placehold.co/800x600/png?text=Camara',
    unitPriceCents: 11990000,
    currency: 'COP',
    stock: 10,
    active: true,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    sku: 'ACC-001',
    name: 'Cargador USB-C de 65 W',
    category: 'accesorios',
    description:
      'Cargador de pared USB-C con Power Delivery y potencia máxima de 65 W para equipos compatibles. Incluye cable USB-C. La potencia efectiva depende del dispositivo conectado.',
    imageUrl: 'https://placehold.co/800x600/png?text=Cargador',
    unitPriceCents: 9990000,
    currency: 'COP',
    stock: 20,
    active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    sku: 'ACC-002',
    name: 'Hub USB-C de seis puertos',
    category: 'accesorios',
    description:
      'Adaptador con conexión USB-C, dos puertos USB-A, salida HDMI, lectores SD y microSD y puerto USB-C para alimentación. La salida de video requiere un equipo compatible con DisplayPort Alt Mode.',
    imageUrl: 'https://placehold.co/800x600/png?text=Hub',
    unitPriceCents: 14990000,
    currency: 'COP',
    stock: 14,
    active: true,
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    sku: 'ALM-001',
    name: 'SSD portátil de 1 TB',
    category: 'almacenamiento',
    description:
      'Unidad de estado sólido externa de 1 TB con conexión USB-C y carcasa compacta. Incluye cable USB-C y adaptador USB-A. La capacidad disponible depende del formato del sistema.',
    imageUrl: 'https://placehold.co/800x600/png?text=SSD',
    unitPriceCents: 32990000,
    currency: 'COP',
    stock: 8,
    active: true,
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    sku: 'HOG-001',
    name: 'Bombillo inteligente Wi-Fi RGB',
    category: 'hogar-inteligente',
    description:
      'Bombillo LED de 9 W con base E27, luz blanca y colores RGB. Permite controlar brillo y horarios mediante su aplicación. Requiere una red Wi-Fi de 2,4 GHz.',
    imageUrl: 'https://placehold.co/800x600/png?text=Bombillo',
    unitPriceCents: 4990000,
    currency: 'COP',
    stock: 25,
    active: true,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sku: 'HOG-002',
    name: 'Enchufe inteligente Wi-Fi',
    category: 'hogar-inteligente',
    description:
      'Enchufe inteligente de uso interior para alimentación de 110–120 V, con encendido remoto y programación de horarios. Soporta una carga máxima de 10 A y requiere Wi-Fi de 2,4 GHz.',
    imageUrl: 'https://placehold.co/800x600/png?text=Enchufe',
    unitPriceCents: 5990000,
    currency: 'COP',
    stock: 16,
    active: true,
  },
];

export async function seedProducts(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    // Ignore both SKU and ID conflicts. Never overwrite prices or consumed stock.
    await manager
      .createQueryBuilder()
      .insert()
      .into(ProductOrmEntity)
      .values(catalogProducts)
      .orIgnore()
      .execute();
  });
}
