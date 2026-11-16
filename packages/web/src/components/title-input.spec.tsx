import { fireEvent, render, screen } from '@testing-library/react';

import { TitleInput } from './title-input.js';


describe('TitleInput', () => {
  it('should end the edit once, even when the field is left after Enter', () => {
    const onSave = rs.fn();
    const onDone = rs.fn();
    render(<TitleInput title="Alpha" label="Title" onSave={onSave} onDone={onDone} />);
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith('Beta');
    expect(onDone).toHaveBeenCalledOnce();
  });
});
