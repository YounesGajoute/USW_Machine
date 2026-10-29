export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Bounds = { left: number; top: number; width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type Geometry = { weld_zone: Rect; heat_shrink_zone: Rect; weld_center_left_x_px: number; weld_center_right_x_px: number }
export const MIN_ZONE_SIZE: number
export const MIN_GUIDE_GAP: number
export function pointerToSource(clientX: number, clientY: number, bounds: Bounds, image: Size): Point
export function imageSizeFromConfig(config: Record<string, any>): Size | null
export function normalizeGeometry(config: Record<string, any>, image: Size): Geometry
export function moveZone(geometry: Geometry, zone: 'weld_zone' | 'heat_shrink_zone', dx: number, dy: number, image: Size): Geometry
export function resizeZone(geometry: Geometry, zone: 'weld_zone' | 'heat_shrink_zone', edge: string, dx: number, dy: number, image: Size): Geometry
export function moveGuide(geometry: Geometry, side: 'left' | 'right', x: number, image: Size): Geometry
export function centerX(geometry: Geometry): number
export function centerY(geometry: Geometry): number
export function geometryError(geometry: Geometry | null, image: Size): string | null
export type ImageView = { zoom: number; x: number; y: number }
export function clampImagePan(pan: Point, zoom: number, canvas: Size, viewport: Size): Point
export function zoomImageAt(view: ImageView, requestedZoom: number, focus: Point, canvas: Size, viewport: Size): ImageView
