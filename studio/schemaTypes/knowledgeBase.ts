import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'knowledgeBase',
  title: 'Knowledge Base Article',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          {title: 'IT', value: 'IT'},
          {title: 'HR', value: 'HR'},
          {title: 'Engineering', value: 'Engineering'},
          {title: 'Security', value: 'Security'},
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          {title: 'Published', value: 'published'},
          {title: 'Draft', value: 'draft'},
          {title: 'Archived', value: 'archived'},
        ],
      },
      initialValue: 'draft',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'text',
      rows: 20,
      validation: (Rule) => Rule.required().min(100),
    }),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'category',
      status: 'status',
    },
    prepare({title, subtitle, status}) {
      return {
        title: title,
        subtitle: `${subtitle} • ${status}`,
      }
    },
  },
})
