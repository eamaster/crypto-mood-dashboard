import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DataCard from '../src/lib/components/DataCard.svelte';
import SlotComponent from './SlotComponent.svelte';

describe('DataCard', () => {
    it('should render the title', () => {
        render(DataCard, { title: 'Test Title' });
        expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('should render the slot content when not loading and no error', () => {
        const { getByText } = render(DataCard, {
            title: 'Test Title',
            slot: '<div>Slot Content</div>',
        });
        expect(getByText('Slot Content')).toBeInTheDocument();
    });

    it('should render the loading state', () => {
        render(DataCard, { title: 'Test Title', loading: true });
        expect(screen.getByText('Loading data...')).toBeInTheDocument();
    });

    it('should render the error state', () => {
        render(DataCard, { title: 'Test Title', error: 'Test Error' });
        expect(screen.getByText('Data unavailable')).toBeInTheDocument();
        expect(screen.getByText('Test Error')).toBeInTheDocument();
    });
});
