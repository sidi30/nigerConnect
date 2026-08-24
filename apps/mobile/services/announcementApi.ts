import { api } from './api';

/** Une annonce de l'équipe, telle qu'un membre la lit en entier. */
export interface Announcement {
  id: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  sentAt: string;
}

export const announcementApi = {
  /**
   * Le texte complet d'une annonce reçue. La notification n'en porte qu'un
   * aperçu de 140 caractères ; c'est ici qu'on va chercher le reste.
   * Le serveur refuse (404) une campagne que ce compte n'a pas reçue.
   */
  async get(id: string): Promise<Announcement> {
    const { data } = await api.get<Announcement>(`/newsletter/announcements/${id}`);
    return data;
  },
};
