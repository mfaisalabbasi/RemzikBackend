import { IsString } from 'class-validator';

export class AdminNoteDto {
  @IsString()
  note: string;
}
