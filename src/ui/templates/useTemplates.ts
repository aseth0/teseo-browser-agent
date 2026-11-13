import { templateStore } from '../../templates/store';
import { useCollection } from '../useCollection';

// The site templates, kept up to date: apart from their Settings screen, which the side panel does not load.
export const useTemplates = () => useCollection(templateStore);
