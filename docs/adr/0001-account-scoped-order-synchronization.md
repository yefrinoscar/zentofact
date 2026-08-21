# Synchronize marketplace orders by channel account

ZentoFact synchronizes orders per `order_channel_accounts` row and stores every marketplace order in the canonical `orders` model. The scheduler uses one cursor and one run history per channel account because provider order identifiers are unique only inside that account. Falabella keeps its legacy writes during migration, but the unified orders page reads PostgreSQL only. Order synchronization and automatic document emission remain separate controls and separate workers.

The first automatic run reads the last five calendar days in Lima. Later runs start ten minutes before the last successful cursor and never read farther back than five days. An order with missing items or an unmapped provider status remains visible, but cannot trigger inventory or billing effects.
