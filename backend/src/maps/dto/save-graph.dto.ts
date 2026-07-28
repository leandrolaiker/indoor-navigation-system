import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PoiDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsBoolean()
  isEntrance: boolean;
}

export class WaypointDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

export class EdgeDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  fromPoiId: string;

  @IsString()
  @IsNotEmpty()
  toPoiId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WaypointDto)
  waypoints?: WaypointDto[];
}

export class ZoneDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsNumber()
  width: number;

  @IsNumber()
  height: number;
}

export class SaveGraphDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PoiDto)
  pois: PoiDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  edges: EdgeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZoneDto)
  zones?: ZoneDto[];
}
