import { getSupabase } from "../supabase";
import type { Workout } from "../memory/types";

export interface WorkoutInput {
  exercise: string;
  sets?: number;
  reps?: number;
  weight_kg?: number;
  duration_min?: number;
  notes?: string;
  source_message_id?: string;
}

export interface ListWorkoutsOptions {
  limit?: number;
  since?: string;
}

export interface SearchWorkoutsOptions {
  exercise?: string;
  query?: string;
  since?: string;
  limit?: number;
}

export async function insertWorkout(
  userId: string,
  input: WorkoutInput,
): Promise<Workout> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("workouts")
    .insert({
      user_id: userId,
      exercise: input.exercise,
      sets: input.sets ?? null,
      reps: input.reps ?? null,
      weight_kg: input.weight_kg ?? null,
      duration_min: input.duration_min ?? null,
      notes: input.notes ?? null,
      source_message_id: input.source_message_id ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Workout;
}

export async function getRecentWorkouts(
  userId: string,
  limit = 5,
): Promise<Workout[]> {
  return listWorkouts(userId, { limit });
}

export async function listWorkouts(
  userId: string,
  options: ListWorkoutsOptions = {},
): Promise<Workout[]> {
  const supabase = getSupabase();
  const { limit = 20, since } = options;

  let query = supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .order("logged_at", { ascending: false })
    .limit(limit);

  if (since) {
    query = query.gte("logged_at", since);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Workout[];
}

export async function getWorkoutForUser(
  userId: string,
  workoutId: string,
): Promise<Workout | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", workoutId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as Workout | null;
}

export interface UpdateWorkoutInput {
  exercise?: string;
  sets?: number | null;
  reps?: number | null;
  weight_kg?: number | null;
  duration_min?: number | null;
  notes?: string | null;
}

export async function updateWorkout(
  userId: string,
  workoutId: string,
  input: UpdateWorkoutInput,
): Promise<Workout> {
  const supabase = getSupabase();
  const updates: Record<string, string | number | null> = {};

  if (input.exercise !== undefined) updates.exercise = input.exercise.trim();
  if (input.sets !== undefined) updates.sets = input.sets;
  if (input.reps !== undefined) updates.reps = input.reps;
  if (input.weight_kg !== undefined) updates.weight_kg = input.weight_kg;
  if (input.duration_min !== undefined) updates.duration_min = input.duration_min;
  if (input.notes !== undefined) updates.notes = input.notes;

  const { data, error } = await supabase
    .from("workouts")
    .update(updates)
    .eq("id", workoutId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Workout;
}

export async function deleteWorkout(
  userId: string,
  workoutId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("workouts")
    .delete()
    .eq("id", workoutId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function searchWorkouts(
  userId: string,
  options: SearchWorkoutsOptions = {},
): Promise<Workout[]> {
  const supabase = getSupabase();
  const { exercise, query, since, limit = 20 } = options;
  const searchTerm = (query ?? exercise)?.trim();

  let dbQuery = supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .order("logged_at", { ascending: false })
    .limit(Math.min(limit, 50));

  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    dbQuery = dbQuery.or(`exercise.ilike.${pattern},notes.ilike.${pattern}`);
  }

  if (since) {
    dbQuery = dbQuery.gte("logged_at", since);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;
  return (data ?? []) as Workout[];
}
