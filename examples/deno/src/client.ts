import type { IslandLoader } from "zogan/client";
import { islands } from "virtual:zogan/islands";

const islandLoaders: Readonly<Record<string, IslandLoader>> = islands;

void islandLoaders;
