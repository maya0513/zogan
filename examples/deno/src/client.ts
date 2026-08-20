import type { IslandLoader } from "zogan/client";
import { startFragments } from "zogan/fragments";
import { islands } from "virtual:zogan/islands";

const islandLoaders: Readonly<Record<string, IslandLoader>> = islands;

void islandLoaders;
startFragments();
