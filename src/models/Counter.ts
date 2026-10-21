import { Schema, model, models } from 'mongoose';

const CounterSchema = new Schema({ key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } });
export const CounterModel = models.Counter || model('Counter', CounterSchema);

export async function nextSequence(key: string): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  return doc.seq as number;
}
