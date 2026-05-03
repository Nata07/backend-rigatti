import type { EntityId, Timestamped } from "./common";

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
  imagePath?: string;
}

export interface Product extends ProductInput, Timestamped {
  id: EntityId;
  companyId: EntityId;
}
