export interface ProfileLink {
  github: string;
  linkedin: string;
  huggingface: string;
  email: string;
  cv: string;
}

export interface ProfileHeadline {
  value: string;
  unit: string;
  label: string;
  source: string;
}

export interface ProfileExperience {
  from: string;
  to: string | null;
  role: string;
  org: string;
  place: string;
  note: string;
}

export interface ProfileEducation {
  year: string;
  title: string;
  org: string;
}

export interface Profile {
  name: string;
  role: string;
  tagline: string;
  location: string;
  links: ProfileLink;
  headlines: ProfileHeadline[];
  experience: ProfileExperience[];
  education: ProfileEducation[];
}