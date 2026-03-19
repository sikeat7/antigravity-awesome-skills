import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Skill, StarMap } from '../types';
import { supabase } from '../lib/supabase';

interface SkillContextType {
    skills: Skill[];
    stars: StarMap;
    loading: boolean;
    refreshSkills: () => Promise<void>;
}

interface SkillsIndexUrlInput {
    baseUrl: string;
    origin: string;
    pathname: string;
}

const SkillContext = createContext<SkillContextType | undefined>(undefined);

function normalizeBasePath(baseUrl: string): string {
    const normalizedSegments = baseUrl
        .trim()
        .split('/')
        .filter((segment) => segment.length > 0 && segment !== '.');

    const normalizedPath = normalizedSegments.length > 0
        ? `/${normalizedSegments.join('/')}`
        : '/';

    return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;
}

export function getSkillsIndexCandidateUrls({
    baseUrl,
    origin,
    pathname,
}: SkillsIndexUrlInput): string[] {
    const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const firstSegment = normalizedPathname.split('/').filter(Boolean)[0];
    const rootPath = firstSegment ? `/${firstSegment}/` : '/';

    const candidates = new Set<string>([
        new URL('skills.json', new URL(normalizeBasePath(baseUrl), origin)).href,
        `${origin}/skills.json`,
        `${origin}${rootPath}skills.json`,
    ]);

    return Array.from(candidates);
}

export function SkillProvider({ children }: { children: React.ReactNode }) {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [stars, setStars] = useState<StarMap>({});
    const [loading, setLoading] = useState(true);

    const fetchSkillsAndStars = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            // Fetch skills index
            const candidateUrls = getSkillsIndexCandidateUrls({
                baseUrl: import.meta.env.BASE_URL,
                origin: window.location.origin,
                pathname: window.location.pathname,
            });

            let data: Skill[] | null = null;
            let lastError: Error | null = null;

            for (const url of candidateUrls) {
                try {
                    const res = await fetch(url);
                    if (!res.ok) {
                        throw new Error(`Request failed (${res.status}) for ${url}`);
                    }

                    const parsed = await res.json();
                    if (!Array.isArray(parsed) || parsed.length === 0) {
                        throw new Error(`Invalid or empty payload from ${url}`);
                    }

                    data = parsed as Skill[];
                    break;
                } catch (err) {
                    lastError = err instanceof Error ? err : new Error(String(err));
                }
            }

            if (!Array.isArray(data)) {
                throw lastError || new Error('Unable to load skills.json from any known source');
            }

            // Incremental loading: set first 50 skills immediately if not a silent refresh
            if (!silent && data.length > 50) {
                setSkills(data.slice(0, 50));
                setLoading(false); // Clear loading state as soon as we have initial content
            } else {
                setSkills(data);
            }

            // Fetch stars from Supabase if available
            if (supabase) {
                const { data: starData, error } = await supabase
                    .from('skill_stars')
                    .select('skill_id, star_count');

                if (!error && starData) {
                    const starMap: StarMap = {};
                    starData.forEach((item: { skill_id: string; star_count: number }) => {
                        starMap[item.skill_id] = item.star_count;
                    });
                    setStars(starMap);
                }
            }

            // Finally set the full set of skills if we did incremental load
            if (!silent && data.length > 50) {
                setSkills(data);
            } else if (silent) {
                setSkills(data);
            }

        } catch (err) {
            console.error('SkillContext: Failed to load skills', err);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSkillsAndStars();
    }, [fetchSkillsAndStars]);

    const refreshSkills = useCallback(async () => {
        await fetchSkillsAndStars(true);
    }, [fetchSkillsAndStars]);

    const value = useMemo(() => ({
        skills,
        stars,
        loading,
        refreshSkills
    }), [skills, stars, loading, refreshSkills]);

    return (
        <SkillContext.Provider value={value}>
            {children}
        </SkillContext.Provider>
    );
}

export function useSkills() {
    const context = useContext(SkillContext);
    if (context === undefined) {
        throw new Error('useSkills must be used within a SkillProvider');
    }
    return context;
}
