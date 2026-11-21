import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';


/** A prompt of the composer history; a greater `id` is a more recent prompt. */
@Entity('prompt_history')
export class PromptHistoryEntity {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'text' })
  prompt: string;
}
