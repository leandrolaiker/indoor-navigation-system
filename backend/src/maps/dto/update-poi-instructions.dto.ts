import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body para PUT /maps/:id/pois/:poiId/instructions.
 * `manualInstructions` vacío o ausente hace que el POI vuelva a modo
 * 'auto' (se descarta el texto manual guardado, ver MapsService.updatePoiInstructions).
 */
export class UpdatePoiInstructionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  manualInstructions?: string | null;
}
