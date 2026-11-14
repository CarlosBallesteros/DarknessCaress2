import type { ClassKey, Meta, Unit } from "../types";

export function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function pointInList(p: [number, number], list: [number, number][]): boolean {
  return list.some((q) => samePoint(p, q));
}

export function manhattan(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

export function classRange(meta: Meta, classKey: ClassKey): number[] {
  return meta.classes[classKey]?.range ?? [];
}

export function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}
