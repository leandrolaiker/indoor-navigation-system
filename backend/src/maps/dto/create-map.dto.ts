import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateMapDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}
