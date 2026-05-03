export type EntityId = string;

export type ISODateString = string & { readonly __brand: "ISODateString" };

export type Nullable<T> = T | null;

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}
