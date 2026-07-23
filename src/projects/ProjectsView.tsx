import { Plus, Search } from "lucide-react";
import { useMemo } from "react";
import type { AirdropProject, ChromeProfile } from "../types";
import { projectDisplayUrls } from "../domain/projectModel";
import { ProjectCard } from "./ProjectCard";

interface ProjectsViewProps {
  projects: AirdropProject[];
  profiles: ChromeProfile[];
  openingProjectId: string | null;
  projectQuery: string;
  onProjectQueryChange: (value: string) => void;
  onCreateProject: () => void;
  onOpenProject: (project: AirdropProject, projectUrlId?: string) => void;
  onStopProject: () => void;
  onEditProject: (projectId: string) => void;
}

export function ProjectsView({
  projects,
  profiles,
  openingProjectId,
  projectQuery,
  onProjectQueryChange,
  onCreateProject,
  onOpenProject,
  onStopProject,
  onEditProject
}: ProjectsViewProps) {
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );
  const visibleProjects = useMemo(() => {
    const normalizedQuery = projectQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) =>
      [
        project.name,
        project.url,
        project.notes,
        project.id,
        ...projectDisplayUrls(project).flatMap((projectUrl) => [
          projectUrl.name,
          projectUrl.url,
          projectUrl.notes
        ])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [projects, projectQuery]);

  return (
    <>
      <section className="launcher-header">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目名称、网址、备注"
            value={projectQuery}
            onChange={(event) => onProjectQueryChange(event.target.value)}
          />
        </label>
        <div className="header-actions">
          <button className="primary-button" type="button" onClick={onCreateProject}>
            <Plus size={16} />
            新建项目
          </button>
        </div>
      </section>

      <section className="project-grid" aria-label="项目列表">
        {projects.length === 0 ? (
          <div className="empty-state">
            <div>
              <h3>还没有项目</h3>
              <p>项目用于保存多个入口网址、绑定账号和打开间隔，适合每天重复打开活动入口。</p>
            </div>
            <button className="primary-button" type="button" onClick={onCreateProject}>
              <Plus size={16} />
              创建第一个项目
            </button>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="empty-state">
            <div>
              <h3>没有匹配的项目</h3>
              <p>
                没有找到包含“{projectQuery.trim()}”的项目，换个名称、网址或备注关键词再试。
              </p>
            </div>
          </div>
        ) : (
          visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              profiles={project.profileIds
                .map((profileId) => profileById.get(profileId))
                .filter((profile): profile is ChromeProfile => Boolean(profile))}
              opening={openingProjectId === project.id}
              disabled={openingProjectId !== null && openingProjectId !== project.id}
              onOpen={(projectUrlId) => onOpenProject(project, projectUrlId)}
              onStop={onStopProject}
              onEdit={() => onEditProject(project.id)}
            />
          ))
        )}
      </section>
    </>
  );
}
